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
          // autoPlay handles playback — don't call .play() to avoid AbortError
          // when React StrictMode double-invokes effects in development
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

    // FPS counter
    const now = performance.now();
    fpsRef.current.frames++;
    if (now - fpsRef.current.last >= 1000) {
      setFps(fpsRef.current.frames);
      fpsRef.current = { frames: 0, last: now };
    }

    if (!mpReady) return;

    const { landmarks } = detect(video);

    // Draw skeleton on canvas overlay
    const canvas = canvasRef.current;
    if (canvas) {
      // Size the canvas to the container (CSS display size), not video native res.
      // drawSkeleton computes the object-cover crop internally using videoWidth/videoHeight.
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
    <div className="flex gap-4 p-4 h-full">
      {/* ── Webcam column ── */}
      <div className="flex-1 flex flex-col gap-3 min-w-0">

        {/* Camera card — video is ALWAYS visible once cam is granted */}
        <div className="relative rounded-3xl overflow-hidden bg-navy-900/40 backdrop-blur-xl border border-white/10 shadow-[0_0_40px_rgba(45,212,191,0.1)] flex-1 min-h-0 ring-1 ring-white/5">

          {/* Camera blocked — full overlay only when we truly have no feed */}
          {camError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 bg-navy-900">
              <div className="w-12 h-12 rounded-2xl bg-red-900/60 border border-red-700/50 flex items-center justify-center">
                <XIcon className="w-6 h-6 text-red-400" />
              </div>
              <p className="text-sm text-red-300 text-center max-w-xs">{camError}</p>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-1.5 rounded-xl bg-red-800/60 hover:bg-red-700/60 text-sm text-red-200 transition-colors cursor-pointer border border-red-700/40"
              >
                Reload &amp; retry
              </button>
            </div>
          ) : (
            <>
              {/* Live video */}
              <video
                ref={videoRef}
                className="w-full h-full object-cover scale-x-[-1]"
                autoPlay
                muted
                playsInline
              />

              {/* Skeleton overlay */}
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
              />

              {/* ── Top-left status chips ── */}
              <div className="absolute top-3 left-3 flex gap-2 flex-wrap">
                <span className="bg-black/50 backdrop-blur-sm text-[11px] px-2.5 py-1 rounded-lg text-slate-300 font-mono border border-white/10">
                  {fps} fps
                </span>
                {mpReady ? (
                  <span className="bg-teal-700/80 backdrop-blur-sm text-[11px] px-2.5 py-1 rounded-lg text-white border border-teal-500/40">
                    Hand detection ✓
                  </span>
                ) : mpError ? (
                  <span className="bg-red-900/80 backdrop-blur-sm text-[11px] px-2.5 py-1 rounded-lg text-red-300 border border-red-700/40 max-w-[200px] truncate" title={mpError}>
                    MP error — check console
                  </span>
                ) : (
                  <span className="bg-yellow-900/80 backdrop-blur-sm text-[11px] px-2.5 py-1 rounded-lg text-yellow-300 border border-yellow-700/40 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                    {loadingMsg}
                  </span>
                )}
                {tfReady && (
                  <span className="bg-teal-700/80 backdrop-blur-sm text-[11px] px-2.5 py-1 rounded-lg text-white border border-teal-500/40">
                    TF.js ✓
                  </span>
                )}
              </div>

              {/* ── Detected letter badge ── */}
              {localLetter && mpReady && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
                  <div className="bg-navy-950/60 backdrop-blur-xl border border-teal-500/30 rounded-3xl px-8 py-4 flex flex-col items-center shadow-[0_8px_32px_rgba(0,0,0,0.5)] ring-1 ring-white/10">
                    <span
                      className="text-7xl font-bold text-teal-400 leading-none"
                      style={{ fontFamily: "'Fira Code', monospace" }}
                    >
                      style={{ fontFamily: "'Fira Code', monospace", textShadow: "0 0 20px rgba(45,212,191,0.5)" }}
                    >
                      {localLetter}
                    </span>
                    <div className="w-32 h-1.5 bg-navy-900/80 rounded-full overflow-hidden mt-3 ring-1 ring-white/5">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-150",
                          localConf > 0.9 ? "bg-teal-400" : localConf > 0.75 ? "bg-yellow-400" : "bg-red-400",
                        )}
                        style={{ width: `${confPct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-slate-400 mt-0.5">{confPct}% confidence</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Autocomplete suggestions */}
        {suggestions.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => handleSuggestion(s)}
                className="px-5 py-2 bg-navy-800/60 backdrop-blur-md hover:bg-teal-500/20 text-sm rounded-xl transition-all duration-300 border border-white/10 hover:border-teal-500/50 hover:shadow-[0_0_15px_rgba(45,212,191,0.2)] cursor-pointer font-medium text-slate-200 hover:text-teal-300"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Output column ── */}
      <div className="w-72 flex flex-col gap-3 shrink-0">

        <div className="bg-navy-900/40 backdrop-blur-xl rounded-3xl p-5 border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.3)] ring-1 ring-white/5">
          <p className="text-[10px] text-teal-500/70 uppercase tracking-widest mb-2 font-bold">Signing</p>
          <p className="text-4xl font-bold text-white min-h-[3rem] leading-tight drop-shadow-md" style={{ fontFamily: "'Fira Code', monospace" }}>
            {localWord || <span className="text-slate-500 font-normal text-xl">waiting…</span>}
          </p>
        </div>

        <div className="bg-navy-900/40 backdrop-blur-xl rounded-3xl p-5 border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.3)] ring-1 ring-white/5 flex-1">
          <p className="text-[10px] text-teal-500/70 uppercase tracking-widest mb-3 font-bold">Text</p>
          <div className="text-[15px] text-white leading-relaxed break-words min-h-[5rem]">
            {localSentence && <span className="text-slate-300">{localSentence}</span>}
            {localWord && <span className="text-teal-400 font-semibold">{localWord}</span>}
            {!fullText && <span className="text-slate-600 text-sm">Start signing to build words…</span>}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSpeak}
            disabled={!fullText}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-gradient-to-r from-teal-500 to-teal-400 hover:from-teal-400 hover:to-teal-300 disabled:opacity-40 disabled:cursor-not-allowed text-navy-950 font-bold text-sm transition-all duration-300 cursor-pointer shadow-[0_0_20px_rgba(45,212,191,0.3)] hover:shadow-[0_0_30px_rgba(45,212,191,0.5)] transform hover:-translate-y-0.5"
          >
            <VolumeIcon className="w-4 h-4" /> Speak
          </button>
          <button onClick={handleBackspace} title="Backspace"
            className="w-12 flex items-center justify-center rounded-2xl bg-navy-800/60 backdrop-blur-md hover:bg-navy-700/80 transition-all duration-300 cursor-pointer border border-white/10 hover:border-white/20 shadow-lg transform hover:-translate-y-0.5 text-slate-300 hover:text-white">
            <DeleteIcon className="w-5 h-5" />
          </button>
          <button onClick={handleClear} title="Clear"
            className="w-12 flex items-center justify-center rounded-2xl bg-navy-800/60 backdrop-blur-md hover:bg-red-500/20 transition-all duration-300 cursor-pointer border border-white/10 hover:border-red-500/50 shadow-lg transform hover:-translate-y-0.5 text-slate-300 hover:text-red-400">
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-navy-900/40 backdrop-blur-xl rounded-3xl p-4 border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.3)] ring-1 ring-white/5">
          <p className="text-[10px] text-teal-500/70 uppercase tracking-widest mb-3 font-bold">Alphabet</p>
          <div className="grid grid-cols-6 gap-1.5">
            {"ABCDEFGHIKLMNOPQRSTUVWXY".split("").map((l) => (
              <button key={l}
                className={cn(
                  "aspect-square flex items-center justify-center text-xs font-mono rounded-xl transition-all duration-300 cursor-pointer border",
                  localLetter === l
                    ? "bg-teal-500 text-navy-950 font-bold border-teal-400 shadow-[0_0_15px_rgba(45,212,191,0.5)] transform scale-110 z-10"
                    : "bg-navy-800/40 hover:bg-navy-700/60 text-slate-400 hover:text-slate-200 border-white/5 hover:border-white/20",
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
