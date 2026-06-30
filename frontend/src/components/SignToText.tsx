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
    <div className="relative flex-1 w-full h-full bg-black overflow-hidden flex flex-col items-center">
      {/* ── Cinematic Camera Layer ── */}
      <div className="absolute inset-0 bg-navy-950 flex items-center justify-center overflow-hidden pointer-events-none">
        {camError ? (
          <div className="flex flex-col items-center justify-center gap-4 p-8 pointer-events-auto">
            <div className="w-16 h-16 rounded-2xl bg-red-900/40 border border-red-700/50 flex items-center justify-center shadow-lg shadow-red-900/50">
              <XIcon className="w-8 h-8 text-red-400" />
            </div>
            <p className="text-red-300 font-medium text-center max-w-sm">{camError}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2.5 rounded-xl bg-red-800/80 hover:bg-red-700/80 text-white font-medium transition-all cursor-pointer border border-red-700/50 shadow-lg"
            >
              Reload &amp; retry
            </button>
          </div>
        ) : (
          <div className="relative w-full h-full pointer-events-auto">
            {/* Live video */}
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
              autoPlay
              muted
              playsInline
            />

            {/* Skeleton overlay */}
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none object-cover"
            />

            {/* Cinematic Gradients */}
            <div className="absolute inset-0 bg-gradient-to-b from-navy-950/80 via-transparent to-navy-950/95 pointer-events-none" />
            
            {/* Glowing active border */}
            <div className={cn(
              "absolute inset-0 border-[3px] rounded-sm transition-all duration-500 pointer-events-none",
              mpReady ? "border-teal-500/20 shadow-[inset_0_0_100px_rgba(43,196,194,0.1)]" : "border-transparent"
            )} />
          </div>
        )}
      </div>

      {/* ── UI Overlay Layer ── */}
      <div className="absolute inset-0 p-6 flex flex-col justify-between pointer-events-none z-10">
        
        {/* Top Header Row (Status Chips & Alphabet) */}
        <div className="flex justify-between items-start w-full">
          {/* Status chips */}
          <div className="flex gap-2 flex-wrap max-w-sm pointer-events-auto">
            <span className="bg-navy-900/60 backdrop-blur-md px-3 py-1.5 rounded-xl text-slate-300 font-mono text-xs border border-white/10 shadow-lg">
              {fps} fps
            </span>
            {mpReady ? (
              <span className="bg-teal-500/20 backdrop-blur-md px-3 py-1.5 rounded-xl text-teal-300 text-xs font-medium border border-teal-500/30 shadow-lg">
                Vision Active
              </span>
            ) : mpError ? (
              <span className="bg-red-900/60 backdrop-blur-md px-3 py-1.5 rounded-xl text-red-300 text-xs border border-red-700/40 shadow-lg" title={mpError}>
                Error
              </span>
            ) : (
              <span className="bg-yellow-900/60 backdrop-blur-md px-3 py-1.5 rounded-xl text-yellow-300 text-xs border border-yellow-700/40 flex items-center gap-2 shadow-lg">
                <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                {loadingMsg}
              </span>
            )}
            {tfReady && (
              <span className="bg-teal-500/20 backdrop-blur-md px-3 py-1.5 rounded-xl text-teal-300 text-xs font-medium border border-teal-500/30 shadow-lg">
                AI Ready
              </span>
            )}
          </div>

          {/* Floating Alphabet Card */}
          <div className="bg-navy-900/60 backdrop-blur-2xl border border-white/10 rounded-2xl p-4 shadow-2xl pointer-events-auto hidden md:block">
            <p className="text-[10px] text-teal-400/80 uppercase tracking-widest mb-3 font-semibold text-center">Reference</p>
            <div className="grid grid-cols-6 gap-1.5">
              {"ABCDEFGHIKLMNOPQRSTUVWXY".split("").map((l) => (
                <button key={l}
                  className={cn(
                    "w-8 h-8 flex items-center justify-center text-[11px] font-mono rounded-lg transition-all duration-300 cursor-pointer",
                    localLetter === l
                      ? "bg-teal-500 text-navy-950 font-bold shadow-[0_0_15px_rgba(43,196,194,0.5)] scale-110"
                      : "bg-white/5 hover:bg-white/10 text-slate-300 border border-white/5",
                  )}
                  onClick={() => speak(l)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Area (Live Translation) */}
        <div className="w-full flex flex-col items-center pb-4">
          
          {/* Huge Detected Letter / Word Overlay */}
          <div className="mb-8 flex flex-col items-center">
            {localLetter && mpReady && (
              <div className="mb-4">
                <span className="text-[140px] font-bold text-teal-400 leading-none drop-shadow-[0_0_40px_rgba(43,196,194,0.4)]" style={{ fontFamily: "'Outfit', sans-serif" }}>
                  {localLetter}
                </span>
                <div className="w-32 h-1.5 bg-navy-900/80 rounded-full overflow-hidden mt-4 mx-auto border border-white/10">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-300",
                      localConf > 0.9 ? "bg-teal-400 shadow-[0_0_10px_rgba(61,219,217,1)]" : localConf > 0.75 ? "bg-yellow-400" : "bg-red-400"
                    )}
                    style={{ width: `${confPct}%` }}
                  />
                </div>
              </div>
            )}
            
            {localWord && (
               <h2 className="text-6xl md:text-7xl font-bold text-white drop-shadow-2xl tracking-tight" style={{ fontFamily: "'Outfit', sans-serif" }}>
                 {localWord}
                 <span className="text-teal-400 animate-pulse ml-1">_</span>
               </h2>
            )}
          </div>

          {/* Autocomplete Suggestions */}
          {suggestions.length > 0 && (
            <div className="flex gap-3 flex-wrap justify-center mb-6 pointer-events-auto">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSuggestion(s)}
                  className="px-5 py-2 bg-navy-800/80 backdrop-blur-xl hover:bg-teal-500 text-slate-200 hover:text-navy-950 text-sm rounded-2xl transition-all duration-300 border border-white/10 hover:border-teal-400 hover:shadow-[0_0_20px_rgba(43,196,194,0.3)] cursor-pointer font-medium hover:-translate-y-1"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Main Subtitle / Translation Card */}
          <div className="max-w-4xl w-full bg-navy-900/75 backdrop-blur-3xl border border-white/10 shadow-2xl rounded-3xl p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 transition-all duration-500 pointer-events-auto relative overflow-hidden">
            {/* Glossy highlight effect inside the card */}
            <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent pointer-events-none" />
            
            <div className="flex-1 w-full relative z-10">
              <p className="text-xs font-bold text-teal-400 uppercase tracking-widest mb-2">Live Translation</p>
              <div className="text-2xl md:text-3xl text-white font-medium leading-relaxed min-h-[4rem] flex items-end">
                <span>
                  {localSentence && <span className="text-slate-200">{localSentence} </span>}
                  {localWord && <span className="text-teal-300">{localWord}</span>}
                  {!fullText && <span className="text-slate-500 italic text-xl">Start signing to construct a sentence...</span>}
                </span>
              </div>
            </div>
            
            {/* Action buttons (Speak, Clear, Backspace) */}
            <div className="flex gap-3 shrink-0 relative z-10 w-full md:w-auto">
              <button
                onClick={handleSpeak}
                disabled={!fullText}
                className="flex-1 md:w-32 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-r from-teal-500 to-teal-400 hover:from-teal-400 hover:to-teal-300 disabled:from-navy-800 disabled:to-navy-800 disabled:text-slate-500 text-navy-950 font-bold transition-all duration-300 cursor-pointer shadow-lg hover:shadow-teal-500/30 hover:-translate-y-0.5"
              >
                <VolumeIcon className="w-5 h-5" /> Speak
              </button>
              <button onClick={handleBackspace} title="Backspace"
                className="w-14 flex items-center justify-center rounded-2xl bg-white/5 hover:bg-white/10 transition-all cursor-pointer border border-white/10 hover:-translate-y-0.5">
                <DeleteIcon className="w-5 h-5 text-slate-300" />
              </button>
              <button onClick={handleClear} title="Clear"
                className="w-14 flex items-center justify-center rounded-2xl bg-white/5 hover:bg-red-500/20 transition-all cursor-pointer border border-white/10 hover:border-red-500/50 hover:-translate-y-0.5 hover:text-red-400">
                <XIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
