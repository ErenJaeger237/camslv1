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
          await videoRef.current.play();
        }
      } catch (e) {
        setCamError("Webcam access denied. Check browser permissions and try again.");
        console.error(e);
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
    if (!video || video.readyState < 2 || !mpReady) return;

    // FPS
    const now = performance.now();
    fpsRef.current.frames++;
    if (now - fpsRef.current.last >= 1000) {
      setFps(fpsRef.current.frames);
      fpsRef.current = { frames: 0, last: now };
    }

    const { landmarks } = detect(video);

    // Draw skeleton on canvas overlay
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        if (landmarks) {
          drawSkeleton(ctx, landmarks, canvas.width, canvas.height);
        } else {
          clearCanvas(ctx, canvas.width, canvas.height);
        }
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
  const handleBackspace = () => { builder.backspace(); setLocalWord(builder.currentWord); setLocalSentence(builder.sentence); };
  const handleSpeak = () => { const t = builder.fullText; if (t) speak(t); };
  const handleSuggestion = (w: string) => {
    builder.acceptSuggestion(w);
    setLocalWord(builder.currentWord); setLocalSentence(builder.sentence); setSuggestions([]);
  };

  const fullText = (localSentence + localWord).trim();
  const confPct = Math.round(localConf * 100);

  return (
    <div className="flex gap-4 p-4 h-full">
      {/* ── Webcam column ── */}
      <div className="flex-1 flex flex-col gap-3 min-w-0">

        {/* Camera card */}
        <div className="relative rounded-2xl overflow-hidden bg-navy-800 border border-navy-700/60 shadow-xl shadow-black/30 flex-1 min-h-0">
          <video
            ref={videoRef}
            className="w-full h-full object-cover scale-x-[-1]"
            muted
            playsInline
          />
          {/* Skeleton overlay — same size/flip as video */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full scale-x-[-1] pointer-events-none"
          />

          {/* Top-left status chips */}
          <div className="absolute top-3 left-3 flex gap-2 flex-wrap">
            <span className="bg-black/50 backdrop-blur-sm text-[11px] px-2.5 py-1 rounded-lg text-slate-300 font-mono border border-white/10">
              {fps} fps
            </span>
            {mpReady && (
              <span className="bg-teal-600/80 backdrop-blur-sm text-[11px] px-2.5 py-1 rounded-lg text-white border border-teal-500/40">
                MediaPipe ✓
              </span>
            )}
            {tfReady && (
              <span className="bg-teal-600/80 backdrop-blur-sm text-[11px] px-2.5 py-1 rounded-lg text-white border border-teal-500/40">
                TF.js ✓
              </span>
            )}
          </div>

          {/* Letter overlay */}
          {localLetter && mpReady && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
              <div className="bg-navy-900/80 backdrop-blur-sm border border-teal-500/30 rounded-2xl px-6 py-3 flex flex-col items-center shadow-xl">
                <span className="text-7xl font-bold text-teal-400 leading-none" style={{ fontFamily: "'Fira Code', monospace" }}>
                  {localLetter}
                </span>
                <div className="w-28 h-1.5 bg-navy-700 rounded-full overflow-hidden mt-2">
                  <div
                    className={cn("h-full rounded-full transition-all duration-150",
                      localConf > 0.9 ? "bg-teal-400" : localConf > 0.75 ? "bg-yellow-400" : "bg-red-400"
                    )}
                    style={{ width: `${confPct}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-400 mt-0.5">{confPct}% confidence</span>
              </div>
            </div>
          )}

          {/* Loading overlay */}
          {!mpReady && !mpError && !camError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-navy-900/80 backdrop-blur-sm gap-4">
              <div className="w-12 h-12 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-300 text-center max-w-xs">{loadingMsg}</p>
              <p className="text-xs text-slate-500">First load downloads ~10 MB — cached after</p>
            </div>
          )}

          {/* Error overlay */}
          {(camError || mpError) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-navy-900/90 backdrop-blur-sm gap-3 p-6">
              <div className="w-12 h-12 rounded-2xl bg-red-900/60 border border-red-700/50 flex items-center justify-center">
                <XIcon className="w-6 h-6 text-red-400" />
              </div>
              <p className="text-sm text-red-300 text-center max-w-xs">{camError ?? mpError}</p>
              {camError && (
                <button
                  onClick={() => window.location.reload()}
                  className="mt-1 px-4 py-1.5 rounded-xl bg-red-800/60 hover:bg-red-700/60 text-sm text-red-200 transition-colors cursor-pointer border border-red-700/40"
                >
                  Reload page
                </button>
              )}
            </div>
          )}
        </div>

        {/* Autocomplete row */}
        {suggestions.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => handleSuggestion(s)}
                className="px-4 py-1.5 bg-navy-700 hover:bg-teal-600 text-sm rounded-xl transition-all duration-200 border border-navy-600 hover:border-teal-500 cursor-pointer font-medium shadow"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Output column ── */}
      <div className="w-72 flex flex-col gap-3 shrink-0">

        {/* Current letter card */}
        <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 shadow-lg">
          <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2 font-semibold">Signing</p>
          <p className="text-4xl font-bold text-teal-400 min-h-[3rem] leading-tight" style={{ fontFamily: "'Fira Code', monospace" }}>
            {localWord || <span className="text-slate-600 font-normal text-2xl">waiting…</span>}
          </p>
        </div>

        {/* Full text card */}
        <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 shadow-lg flex-1">
          <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-3 font-semibold">Text</p>
          <div className="text-[15px] text-white leading-relaxed break-words min-h-[5rem]">
            {localSentence && <span className="text-slate-300">{localSentence}</span>}
            {localWord && <span className="text-teal-400 font-semibold">{localWord}</span>}
            {!fullText && <span className="text-slate-600 text-sm">Start signing to build words…</span>}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleSpeak}
            disabled={!fullText}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-40 disabled:cursor-not-allowed text-navy-950 font-semibold text-sm transition-all duration-200 cursor-pointer shadow-lg shadow-teal-900/40"
          >
            <VolumeIcon className="w-4 h-4" />
            Speak
          </button>
          <button
            onClick={handleBackspace}
            className="w-10 flex items-center justify-center rounded-xl bg-navy-700 hover:bg-navy-600 transition-colors cursor-pointer border border-navy-600"
            title="Backspace"
          >
            <DeleteIcon className="w-4 h-4" />
          </button>
          <button
            onClick={handleClear}
            className="w-10 flex items-center justify-center rounded-xl bg-navy-700 hover:bg-red-900/60 transition-colors cursor-pointer border border-navy-600"
            title="Clear"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Letter reference grid */}
        <div className="bg-navy-800 rounded-2xl p-3 border border-navy-700/60 shadow">
          <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2.5 font-semibold">Alphabet</p>
          <div className="grid grid-cols-6 gap-1">
            {"ABCDEFGHIKLMNOPQRSTUVWXY".split("").map((l) => (
              <button
                key={l}
                className={cn(
                  "aspect-square flex items-center justify-center text-xs font-mono rounded-lg transition-all duration-150 cursor-pointer border",
                  localLetter === l
                    ? "bg-teal-500 text-navy-950 font-bold border-teal-400"
                    : "bg-navy-700 hover:bg-navy-600 text-slate-300 border-navy-600"
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
