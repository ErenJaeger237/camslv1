import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaPipe } from "../hooks/useMediaPipe";
import { useInference } from "../hooks/useInference";
import { WordBuilder } from "../lib/wordBuilder";
import { normaliseLandmarks } from "../lib/landmarks";
import { drawSkeleton, clearCanvas } from "../lib/skeleton";
import { speak } from "../lib/tts";
import { getAutocomplete } from "../lib/api";
import { useAppStore } from "../store/appStore";
import { cn } from "../lib/utils";
import { VolumeIcon, DeleteIcon, XIcon } from "./icons";

const builder = new WordBuilder();

// ── Circular confidence ring ──────────────────────────────────────
function ConfRing({ pct }: { pct: number }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const color = pct >= 90 ? "#2dd4bf" : pct >= 75 ? "#facc15" : "#f87171";
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" className="rotate-[-90deg]">
      <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
      <circle
        cx="24" cy="24" r={r}
        fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={circ}
        strokeDashoffset={circ - (circ * pct) / 100}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 150ms ease, stroke 150ms ease" }}
      />
    </svg>
  );
}

export function SignToText() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const [camError, setCamError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const fpsRef = useRef({ frames: 0, last: performance.now() });

  const { ready: mpReady, error: mpError, loadingMsg, detect } = useMediaPipe();
  const { ready: tfReady, predict } = useInference();

  const { setSignResult, setSuggestions, suggestions } = useAppStore();
  const [localWord, setLocalWord] = useState("");
  const [localSentence, setLocalSentence] = useState("");
  const [localLetter, setLocalLetter] = useState("");
  const [localConf, setLocalConf] = useState(0);
  const lastWordRef = useRef("");

  // Start webcam
  useEffect(() => {
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
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

  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop);
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    const now = performance.now();
    fpsRef.current.frames++;
    if (now - fpsRef.current.last >= 1000) {
      setFps(fpsRef.current.frames);
      fpsRef.current = { frames: 0, last: now };
    }

    if (!mpReady) return;

    const { landmarks } = detect(video);

    const canvas = canvasRef.current;
    if (canvas) {
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 480;
        if (landmarks) drawSkeleton(ctx, landmarks, cw, ch, vw, vh);
        else clearCanvas(ctx, cw, ch);
      }
    }

    let pred = null;
    if (landmarks && tfReady) {
      pred = predict(normaliseLandmarks(landmarks));
    }

    const committed = builder.update(pred?.letter ?? null, pred?.confidence ?? 0);
    const word = builder.currentWord;
    const sentence = builder.sentence;

    setLocalLetter(pred?.letter ?? "");
    setLocalConf(pred?.confidence ?? 0);
    setLocalWord(word);
    setLocalSentence(sentence);
    setSignResult(pred?.letter ?? "", pred?.confidence ?? 0, word, sentence);

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
  }, [mpReady, tfReady, detect, predict, setSignResult, setSuggestions]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loop]);

  const handleClear = () => {
    builder.clear();
    setLocalWord(""); setLocalSentence(""); setLocalLetter(""); setLocalConf(0);
    setSuggestions([]); setSignResult("", 0, "", "");
  };
  const handleBackspace = () => {
    builder.backspace();
    setLocalWord(builder.currentWord);
    setLocalSentence(builder.sentence);
  };
  const handleSpeak = () => { const t = builder.fullText; if (t) speak(t); };
  const handleSuggestion = (w: string) => {
    builder.acceptSuggestion(w);
    setLocalWord(builder.currentWord);
    setLocalSentence(builder.sentence);
    setSuggestions([]);
  };

  const fullText = (localSentence + localWord).trim();
  const confPct = Math.round(localConf * 100);

  return (
    <div className="flex gap-6 p-6 h-full">

      {/* ── Webcam column ── */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">

        {/* Camera card */}
        <div className="relative rounded-2xl overflow-hidden bg-navy-900 border border-white/8 shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_16px_48px_rgba(0,0,0,0.6)] flex-1 min-h-0">

          {camError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 bg-navy-900">
              <div className="w-12 h-12 rounded-2xl bg-red-900/40 border border-red-700/50 flex items-center justify-center">
                <XIcon className="w-5 h-5 text-red-400" />
              </div>
              <p className="text-sm text-red-300 text-center max-w-xs leading-relaxed">{camError}</p>
              <button
                onClick={() => window.location.reload()}
                className="px-5 py-2 rounded-xl bg-red-800/40 hover:bg-red-700/40 text-sm text-red-200 transition-colors cursor-pointer border border-red-700/40"
              >
                Reload &amp; retry
              </button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                className="w-full h-full object-cover scale-x-[-1]"
                autoPlay muted playsInline
              />
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

              {/* Top-left status chips */}
              <div className="absolute top-4 left-4 flex gap-2 flex-wrap">
                <span className="bg-black/50 backdrop-blur-md text-[10px] px-2.5 py-1 rounded-lg text-slate-400 font-mono border border-white/8">
                  {fps} fps
                </span>
                {mpReady ? (
                  <span className="bg-teal-600/70 backdrop-blur-md text-[10px] px-2.5 py-1 rounded-lg text-white border border-teal-400/30">
                    Hand ✓
                  </span>
                ) : mpError ? (
                  <span className="bg-red-900/70 backdrop-blur-md text-[10px] px-2.5 py-1 rounded-lg text-red-300 border border-red-700/30">
                    MP error
                  </span>
                ) : (
                  <span className="bg-amber-900/70 backdrop-blur-md text-[10px] px-2.5 py-1 rounded-lg text-amber-300 border border-amber-700/30 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    {loadingMsg}
                  </span>
                )}
                {tfReady && (
                  <span className="bg-teal-600/70 backdrop-blur-md text-[10px] px-2.5 py-1 rounded-lg text-white border border-teal-400/30">
                    TF.js ✓
                  </span>
                )}
              </div>

              {/* Detected letter badge — bottom centre with confidence ring */}
              {localLetter && mpReady && (
                <div className="absolute bottom-5 left-1/2 -translate-x-1/2">
                  <div className="bg-navy-950/75 backdrop-blur-xl border border-white/10 rounded-2xl px-5 py-3 flex items-center gap-4 shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
                    {/* Big letter */}
                    <span
                      className="text-6xl font-bold text-teal-400 leading-none"
                      style={{ fontFamily: "'Fira Code', monospace", textShadow: "0 0 24px rgba(45,212,191,0.55)" }}
                    >
                      {localLetter}
                    </span>
                    {/* Confidence ring + label */}
                    <div className="flex flex-col items-center gap-1">
                      <div className="relative">
                        <ConfRing pct={confPct} />
                        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white">
                          {confPct}%
                        </span>
                      </div>
                      <span className="text-[9px] text-slate-500 uppercase tracking-widest">confidence</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Autocomplete suggestions */}
        {suggestions.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            <span className="label-xs self-center mr-1">Suggestions</span>
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => handleSuggestion(s)}
                className="px-4 py-1.5 bg-white/4 hover:bg-teal-500/15 text-sm rounded-xl transition-all duration-200 border border-white/8 hover:border-teal-500/40 cursor-pointer font-medium text-slate-200 hover:text-teal-300"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Output column ── */}
      <div className="w-72 flex flex-col gap-4 shrink-0">

        {/* Signing / current word card */}
        <div className="glass-card p-5">
          <p className="label-xs mb-3">Current Sign</p>
          <p className="text-4xl font-bold text-white min-h-[3rem] leading-tight drop-shadow-sm" style={{ fontFamily: "'Fira Code', monospace" }}>
            {localWord || <span className="text-slate-600 font-normal text-xl">waiting…</span>}
          </p>
        </div>

        {/* Translated text card */}
        <div className="glass-card p-5 flex-1">
          <p className="label-xs mb-3">Translated Text</p>
          <div className="text-[15px] text-white leading-relaxed break-words min-h-[5rem]">
            {localSentence && <span className="text-slate-300">{localSentence}</span>}
            {localWord && <span className="text-teal-400 font-semibold">{localWord}</span>}
            {!fullText && <span className="text-slate-600 text-sm">Start signing to build words…</span>}
          </div>
        </div>

        {/* Actions — primary + secondary grouping */}
        <div className="flex gap-2">
          {/* PRIMARY — Speak */}
          <button
            onClick={handleSpeak}
            disabled={!fullText}
            className="btn-primary flex-1"
          >
            <VolumeIcon className="w-4 h-4" /> Speak
          </button>
          {/* SECONDARY — Backspace */}
          <button onClick={handleBackspace} title="Backspace" className="btn-ghost w-10 px-0">
            <DeleteIcon className="w-4 h-4" />
          </button>
          {/* SECONDARY — Clear */}
          <button onClick={handleClear} title="Clear" className="btn-danger w-10 px-0">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Alphabet grid */}
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
                onClick={() => speak(l)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
