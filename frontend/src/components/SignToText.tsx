import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaPipe } from "../hooks/useMediaPipe";
import { useInference } from "../hooks/useInference";
import { useHolistic } from "../hooks/useHolistic";
import { WordBuilder } from "../lib/wordBuilder";
import { normaliseLandmarks } from "../lib/landmarks";
import { buildHolisticFeatures } from "../lib/holisticLandmarks";
import { drawSkeleton, clearCanvas } from "../lib/skeleton";
import { speak } from "../lib/tts";
import { getAutocomplete, predictSign, getSignLabels } from "../lib/api";
import { useAppStore } from "../store/appStore";
import { cn } from "../lib/utils";
import { VolumeIcon, DeleteIcon, XIcon } from "./icons";

const builder = new WordBuilder();

// Wrist velocity thresholds in normalised coords per frame (~30 fps)
const ONSET_THRESH   = 0.018; // hand starts moving  → begin collecting
const CAPTURE_FRAMES = 30;    // frames to collect   (~1 s at 30 fps)
const COOLDOWN_MS    = 2500;  // wait after predict  before re-triggering

// ── Circular confidence ring ──────────────────────────────────────────────────
function ConfRing({ pct }: { pct: number }) {
  const r = 18, circ = 2 * Math.PI * r;
  const color = pct >= 90 ? "#2dd4bf" : pct >= 75 ? "#facc15" : "#f87171";
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" className="rotate-[-90deg]">
      <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
      <circle cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={circ} strokeDashoffset={circ - (circ * pct) / 100}
        strokeLinecap="round" style={{ transition: "stroke-dashoffset 150ms ease, stroke 150ms ease" }} />
    </svg>
  );
}

export function SignToText() {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const [camError, setCamError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const fpsRef = useRef({ frames: 0, last: performance.now() });

  // ── Mode ──────────────────────────────────────────────────────────────────
  const [wordsMode, setWordsMode] = useState(false);
  const wordsModeRef = useRef(false);

  // ── Word-sign autonomous state ────────────────────────────────────────────
  const prevWristRef     = useRef<{ x: number; y: number } | null>(null);
  const cooldownUntilRef = useRef(0);
  const collectingRef    = useRef(false);
  const signBufferRef    = useRef<number[][]>([]);

  const [collecting, setCollecting]   = useState(false);
  const [frameCount, setFrameCount]   = useState(0);
  const [signResult, setSignResult]   = useState<{ sign: string; confidence: number } | null>(null);
  const [signLoading, setSignLoading] = useState(false);
  const [signError, setSignError]     = useState<string | null>(null);
  const [backendWarm, setBackendWarm] = useState(false);

  // ── Hooks ─────────────────────────────────────────────────────────────────
  const { ready: mpReady, error: mpError, loadingMsg, detect } = useMediaPipe();
  const { ready: tfReady, predict }                             = useInference();
  const { ready: holisticReady, loadingMsg: holisticMsg, detectFacePose } = useHolistic(wordsMode);

  const { setSignResult: storeSignResult, setSuggestions, suggestions } = useAppStore();
  const [localWord, setLocalWord]         = useState("");
  const [localSentence, setLocalSentence] = useState("");
  const [localLetter, setLocalLetter]     = useState("");
  const [localConf, setLocalConf]         = useState(0);
  const lastWordRef = useRef("");

  // ── Webcam ────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (e) {
        const msg = String(e);
        if (!msg.includes("AbortError")) setCamError("Camera blocked: " + msg);
      }
    })();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Pre-warm the backend the moment word-signs mode is activated so the first
  // real prediction doesn't pay the Render cold-start + model-download cost.
  useEffect(() => {
    if (!wordsMode) return;
    getSignLabels()
      .then(() => setBackendWarm(true))
      .catch(() => {}); // silent — retried on first predict call anyway
  }, [wordsMode]);

  // ── Animation loop ────────────────────────────────────────────────────────
  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop);
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !mpReady) return;

    const now = performance.now();
    fpsRef.current.frames++;
    if (now - fpsRef.current.last >= 1000) {
      setFps(fpsRef.current.frames);
      fpsRef.current = { frames: 0, last: now };
    }

    const { landmarks } = detect(video);

    // Skeleton overlay
    const canvas = canvasRef.current;
    if (canvas) {
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
        if (landmarks) drawSkeleton(ctx, landmarks, cw, ch, vw, vh);
        else clearCanvas(ctx, cw, ch);
      }
    }

    // ── Alphabet mode ────────────────────────────────────────────────────
    if (!wordsModeRef.current) {
      let pred = null;
      if (landmarks && tfReady) pred = predict(normaliseLandmarks(landmarks));
      const committed = builder.update(pred?.letter ?? null, pred?.confidence ?? 0);
      const word = builder.currentWord, sentence = builder.sentence;
      setLocalLetter(pred?.letter ?? "");
      setLocalConf(pred?.confidence ?? 0);
      setLocalWord(word);
      setLocalSentence(sentence);
      storeSignResult(pred?.letter ?? "", pred?.confidence ?? 0, word, sentence);
      if (committed || word !== lastWordRef.current) {
        lastWordRef.current = word;
        if (word.length >= 2) {
          getAutocomplete(word)
            .then((r) => { builder.setSuggestions(r.suggestions); setSuggestions(r.suggestions); })
            .catch(() => {});
        } else {
          builder.setSuggestions([]); setSuggestions([]);
        }
      }
      return;
    }

    // ── Word-signs autonomous mode ───────────────────────────────────────
    const wrist = landmarks?.[0] ?? null;

    // Velocity-based onset: trigger collection when hand starts moving
    if (wrist && prevWristRef.current && !collectingRef.current && holisticReady) {
      const dx = wrist.x - prevWristRef.current.x;
      const dy = wrist.y - prevWristRef.current.y;
      const velocity = Math.sqrt(dx * dx + dy * dy);
      if (velocity > ONSET_THRESH && now > cooldownUntilRef.current) {
        collectingRef.current = true;
        signBufferRef.current = [];
        setCollecting(true);
        setFrameCount(0);
        setSignResult(null);
        setSignError(null);
      }
    }
    if (wrist) prevWristRef.current = { x: wrist.x, y: wrist.y };

    // Collect holistic frames — face+pose only called here (~1 s window)
    if (collectingRef.current && landmarks) {
      const { faceLms, poseLms } = detectFacePose(video);
      const features = buildHolisticFeatures(landmarks, faceLms, poseLms);
      if (features) {
        signBufferRef.current.push(Array.from(features));
        const count = signBufferRef.current.length;
        setFrameCount(count);
        if (count >= CAPTURE_FRAMES) {
          collectingRef.current = false;
          setCollecting(false);
          setSignLoading(true);
          cooldownUntilRef.current = now + COOLDOWN_MS;
          const seq = [...signBufferRef.current];
          signBufferRef.current = [];
          setFrameCount(0);
          predictSign(seq)
            .then((r) => { setSignResult(r); setSignLoading(false); })
            .catch((e) => { setSignError(String(e).replace("Error: ", "")); setSignLoading(false); });
        }
      }
    }
  }, [mpReady, tfReady, holisticReady, detect, predict, detectFacePose, storeSignResult, setSuggestions]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loop]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleModeToggle = (wm: boolean) => {
    setWordsMode(wm);
    wordsModeRef.current = wm;
    collectingRef.current = false;
    signBufferRef.current = [];
    prevWristRef.current  = null;
    setCollecting(false); setFrameCount(0);
    setSignResult(null);  setSignError(null);
    if (!wm) {
      builder.clear();
      setLocalWord(""); setLocalSentence(""); setLocalLetter(""); setLocalConf(0);
    }
  };

  const handleClear     = () => { builder.clear(); setLocalWord(""); setLocalSentence(""); setLocalLetter(""); setLocalConf(0); setSuggestions([]); storeSignResult("", 0, "", ""); };
  const handleBackspace = () => { builder.backspace(); setLocalWord(builder.currentWord); setLocalSentence(builder.sentence); };
  const handleSpeak     = () => { const t = builder.fullText; if (t) speak(t); };
  const handleSuggestion = (w: string) => { builder.acceptSuggestion(w); setLocalWord(builder.currentWord); setLocalSentence(builder.sentence); setSuggestions([]); };

  const fullText = (localSentence + localWord).trim();
  const confPct  = Math.round(localConf * 100);
  const capPct   = Math.round((frameCount / CAPTURE_FRAMES) * 100);

  // Word-signs status line
  const signStatus = (() => {
    if (!holisticReady) return holisticMsg ?? "Loading face + pose models…";
    if (!backendWarm)   return "Warming up backend…";
    if (signLoading)    return "Predicting…";
    if (collecting)     return `Recording sign… ${frameCount}/${CAPTURE_FRAMES}`;
    return "Ready — just sign naturally";
  })();

  return (
    <div className="flex gap-6 p-6 h-full">

      {/* ── Webcam column ── */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">

        {/* Mode toggle */}
        <div className="flex gap-1 p-1 bg-navy-900/60 border border-white/6 rounded-xl self-start">
          {(["Alphabet", "Word Signs"] as const).map((label, i) => (
            <button key={label} onClick={() => handleModeToggle(i === 1)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 cursor-pointer",
                wordsMode === (i === 1) ? "bg-teal-500 text-navy-950 shadow" : "text-slate-400 hover:text-white",
              )}>
              {label}
            </button>
          ))}
        </div>

        {/* Camera card */}
        <div className="relative rounded-2xl overflow-hidden bg-navy-900 border border-white/8 shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_16px_48px_rgba(0,0,0,0.6)] flex-1 min-h-0">
          {camError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 bg-navy-900">
              <div className="w-12 h-12 rounded-2xl bg-red-900/40 border border-red-700/50 flex items-center justify-center">
                <XIcon className="w-5 h-5 text-red-400" />
              </div>
              <p className="text-sm text-red-300 text-center max-w-xs leading-relaxed">{camError}</p>
              <button onClick={() => window.location.reload()}
                className="px-5 py-2 rounded-xl bg-red-800/40 hover:bg-red-700/40 text-sm text-red-200 transition-colors cursor-pointer border border-red-700/40">
                Reload &amp; retry
              </button>
            </div>
          ) : (
            <>
              <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" autoPlay muted playsInline />
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

              {/* Status chips */}
              <div className="absolute top-4 left-4 flex gap-2 flex-wrap">
                <span className="bg-black/50 backdrop-blur-md text-[10px] px-2.5 py-1 rounded-lg text-slate-400 font-mono border border-white/8">{fps} fps</span>
                {mpReady ? (
                  <span className="bg-teal-600/70 backdrop-blur-md text-[10px] px-2.5 py-1 rounded-lg text-white border border-teal-400/30">Hand ✓</span>
                ) : mpError ? (
                  <span className="bg-red-900/70 backdrop-blur-md text-[10px] px-2.5 py-1 rounded-lg text-red-300 border border-red-700/30">MP error</span>
                ) : (
                  <span className="bg-amber-900/70 backdrop-blur-md text-[10px] px-2.5 py-1 rounded-lg text-amber-300 border border-amber-700/30 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    {loadingMsg}
                  </span>
                )}
                {!wordsMode && tfReady && (
                  <span className="bg-teal-600/70 backdrop-blur-md text-[10px] px-2.5 py-1 rounded-lg text-white border border-teal-400/30">TF.js ✓</span>
                )}
                {wordsMode && (
                  holisticReady
                    ? <span className="bg-teal-600/70 backdrop-blur-md text-[10px] px-2.5 py-1 rounded-lg text-white border border-teal-400/30">Holistic ✓</span>
                    : <span className="bg-amber-900/70 backdrop-blur-md text-[10px] px-2.5 py-1 rounded-lg text-amber-300 border border-amber-700/30 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        {holisticMsg ?? "Loading…"}
                      </span>
                )}
              </div>

              {/* Alphabet: detected letter badge */}
              {!wordsMode && localLetter && (
                <div className="absolute bottom-5 left-1/2 -translate-x-1/2">
                  <div className="bg-navy-950/75 backdrop-blur-xl border border-white/10 rounded-2xl px-5 py-3 flex items-center gap-4 shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
                    <span className="text-6xl font-bold text-teal-400 leading-none" style={{ fontFamily: "'Fira Code', monospace", textShadow: "0 0 24px rgba(45,212,191,0.55)" }}>
                      {localLetter}
                    </span>
                    <div className="flex flex-col items-center gap-1">
                      <div className="relative">
                        <ConfRing pct={confPct} />
                        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white">{confPct}%</span>
                      </div>
                      <span className="text-[9px] text-slate-500 uppercase tracking-widest">confidence</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Word-signs: progress bar overlay while collecting */}
              {wordsMode && collecting && (
                <div className="absolute bottom-5 left-1/2 -translate-x-1/2 w-52">
                  <div className="bg-navy-950/85 backdrop-blur-xl border border-teal-500/40 rounded-xl px-4 py-3 text-center">
                    <p className="text-[10px] text-teal-300 uppercase tracking-widest mb-2">Recording…</p>
                    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-teal-400 rounded-full transition-all duration-75" style={{ width: `${capPct}%` }} />
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1.5">{frameCount} / {CAPTURE_FRAMES} frames</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Suggestions (alphabet only) */}
        {!wordsMode && suggestions.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            <span className="label-xs self-center mr-1">Suggestions</span>
            {suggestions.map((s) => (
              <button key={s} onClick={() => handleSuggestion(s)}
                className="px-4 py-1.5 bg-white/4 hover:bg-teal-500/15 text-sm rounded-xl transition-all duration-200 border border-white/8 hover:border-teal-500/40 cursor-pointer font-medium text-slate-200 hover:text-teal-300">
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Output column ── */}
      <div className="w-72 flex flex-col gap-4 shrink-0">

        {wordsMode ? (
          <>
            {/* Status card */}
            <div className={cn(
              "glass-card p-4 flex items-center gap-3 text-sm",
              collecting ? "border-teal-500/40" : signLoading ? "border-amber-500/30" : "",
            )}>
              {(collecting || signLoading) && (
                <span className={cn("w-2.5 h-2.5 rounded-full shrink-0 animate-pulse", collecting ? "bg-teal-400" : "bg-amber-400")} />
              )}
              {!collecting && !signLoading && holisticReady && backendWarm && (
                <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-slate-600" />
              )}
              {!collecting && !signLoading && (!holisticReady || !backendWarm) && (
                <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-amber-400 animate-pulse" />
              )}
              <span className="text-slate-300 text-xs">{signStatus}</span>
            </div>

            {/* Result card */}
            <div className="glass-card p-5 flex-1 flex flex-col gap-4">
              <p className="label-xs">Recognised Sign</p>

              {signError && !signLoading && (
                <div className="bg-red-900/30 border border-red-700/40 rounded-xl p-3 text-xs text-red-300">{signError}</div>
              )}

              {signResult && !signLoading && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-end gap-3">
                    <span className="text-4xl font-bold text-teal-400 capitalize" style={{ fontFamily: "'Fira Code', monospace" }}>
                      {signResult.sign.replace(/_/g, " ")}
                    </span>
                    <span className="text-sm text-slate-400 mb-1 font-mono">{Math.round(signResult.confidence * 100)}%</span>
                  </div>
                  <button onClick={() => speak(signResult.sign.replace(/_/g, " "))} className="btn-primary">
                    <VolumeIcon className="w-4 h-4" /> Speak
                  </button>
                </div>
              )}

              {!signResult && !signLoading && !signError && (
                <p className="text-sm text-slate-600 leading-relaxed">
                  {holisticReady && backendWarm
                    ? "Move your hand to perform a sign — detection is automatic."
                    : "Setting up… this takes a few seconds on first use."}
                </p>
              )}
            </div>

            {/* Vocabulary chip grid */}
            <div className="glass-card p-4">
              <p className="label-xs mb-3">14 Available Signs</p>
              <div className="flex flex-wrap gap-1.5">
                {["bad","drink","eat","friend","good","goodbye","help","no","please","school","sick","sorry","thank you","yes"].map((s) => (
                  <span key={s} className={cn(
                    "text-[10px] px-2 py-0.5 rounded-md border capitalize",
                    signResult?.sign.replace(/_/g, " ") === s
                      ? "bg-teal-500/20 border-teal-500/40 text-teal-300"
                      : "bg-white/4 border-white/8 text-slate-500",
                  )}>
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="glass-card p-5">
              <p className="label-xs mb-3">Current Sign</p>
              <p className="text-4xl font-bold text-white min-h-[3rem] leading-tight drop-shadow-sm" style={{ fontFamily: "'Fira Code', monospace" }}>
                {localWord || <span className="text-slate-600 font-normal text-xl">waiting…</span>}
              </p>
            </div>
            <div className="glass-card p-5 flex-1">
              <p className="label-xs mb-3">Translated Text</p>
              <div className="text-[15px] text-white leading-relaxed break-words min-h-[5rem]">
                {localSentence && <span className="text-slate-300">{localSentence}</span>}
                {localWord && <span className="text-teal-400 font-semibold">{localWord}</span>}
                {!fullText && <span className="text-slate-600 text-sm">Start signing to build words…</span>}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSpeak} disabled={!fullText} className="btn-primary flex-1">
                <VolumeIcon className="w-4 h-4" /> Speak
              </button>
              <button onClick={handleBackspace} title="Backspace" className="btn-ghost w-10 px-0">
                <DeleteIcon className="w-4 h-4" />
              </button>
              <button onClick={handleClear} title="Clear" className="btn-danger w-10 px-0">
                <XIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="glass-card p-4">
              <p className="label-xs mb-3">Alphabet</p>
              <div className="grid grid-cols-6 gap-1.5">
                {"ABCDEFGHIKLMNOPQRSTUVWXY".split("").map((l) => (
                  <button key={l}
                    className={cn(
                      "aspect-square flex items-center justify-center text-xs font-mono rounded-lg transition-all duration-200 cursor-pointer border",
                      localLetter === l
                        ? "bg-teal-500 text-navy-950 font-bold border-teal-300 shadow-[0_0_12px_rgba(45,212,191,0.6)] scale-110"
                        : "bg-white/4 hover:bg-white/8 text-slate-400 hover:text-white border-white/6 hover:border-white/16",
                    )}
                    onClick={() => speak(l)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
