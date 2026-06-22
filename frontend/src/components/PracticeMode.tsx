import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaPipe } from "../hooks/useMediaPipe";
import { useInference } from "../hooks/useInference";
import { normaliseLandmarks } from "../lib/landmarks";
import { drawSkeleton, clearCanvas } from "../lib/skeleton";
import { initPractice, recordPracticeResult } from "../lib/api";
import { useAppStore } from "../store/appStore";
import { cn } from "../lib/utils";
import { ChevronRightIcon } from "./icons";

const HOLD_FRAMES = 20;

export function PracticeMode() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const { ready: mpReady, loadingMsg, detect } = useMediaPipe();
  const { ready: tfReady, predict } = useInference();
  const { sessionId, practiceTarget, practiceMastery, setPracticeState, addPracticeResult } = useAppStore();

  const [camError, setCamError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const [detected, setDetected] = useState("");
  const [recentLetters, setRecentLetters] = useState<string[]>([]);
  const holdRef = useRef<string[]>([]);
  const checkedRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      } catch { setCamError("Webcam access denied."); }
    })();
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); cancelAnimationFrame(rafRef.current); };
  }, []);

  useEffect(() => {
    if (!practiceTarget) initPractice(sessionId).then((r) => setPracticeState(r.letter, r.mastery));
  }, [sessionId, practiceTarget, setPracticeState]);

  const handleResult = useCallback(async (correct: boolean) => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    setFeedback(correct ? "correct" : "wrong");
    addPracticeResult(practiceTarget, correct);
    const newRecent = [...recentLetters.slice(-4), practiceTarget];
    setRecentLetters(newRecent);
    setTimeout(async () => {
      const r = await recordPracticeResult(sessionId, practiceTarget, correct, newRecent);
      setPracticeState(r.next_letter, r.mastery);
      setFeedback(null); setDetected(""); holdRef.current = []; checkedRef.current = false;
    }, 1200);
  }, [practiceTarget, sessionId, recentLetters, addPracticeResult, setPracticeState]);

  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop);
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !mpReady || !practiceTarget || feedback) return;
    const { landmarks } = detect(video);

    // Draw skeleton
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        if (landmarks) drawSkeleton(ctx, landmarks, canvas.width, canvas.height);
        else clearCanvas(ctx, canvas.width, canvas.height);
      }
    }

    if (!landmarks) { holdRef.current = []; return; }
    const pred = tfReady ? predict(normaliseLandmarks(landmarks)) : null;
    if (!pred || pred.confidence < 0.85) { holdRef.current = []; return; }
    setDetected(pred.letter);
    holdRef.current.push(pred.letter);
    if (holdRef.current.length > HOLD_FRAMES) holdRef.current.shift();
    if (holdRef.current.length === HOLD_FRAMES && holdRef.current.every((l) => l === pred.letter)) {
      handleResult(pred.letter === practiceTarget);
    }
  }, [mpReady, tfReady, detect, predict, practiceTarget, feedback, handleResult]);

  useEffect(() => { rafRef.current = requestAnimationFrame(loop); return () => cancelAnimationFrame(rafRef.current); }, [loop]);

  return (
    <div className="flex gap-4 p-4 h-full">
      {/* Webcam */}
      <div className="flex-1 relative rounded-2xl overflow-hidden bg-navy-800 border border-navy-700/60 shadow-xl">
        <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" muted playsInline />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full scale-x-[-1] pointer-events-none" />

        {feedback && (
          <div className={cn(
            "absolute inset-0 flex items-center justify-center transition-all",
            feedback === "correct" ? "bg-teal-500/70" : "bg-red-600/70"
          )}>
            <span className="text-7xl font-bold text-white drop-shadow-lg">
              {feedback === "correct" ? "✓" : "✗"}
            </span>
          </div>
        )}

        {detected && !feedback && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <div className="bg-navy-900/80 backdrop-blur-sm border border-teal-500/30 rounded-2xl px-6 py-2">
              <span className="text-5xl font-bold text-teal-400" style={{ fontFamily: "'Fira Code', monospace" }}>
                {detected}
              </span>
            </div>
          </div>
        )}

        {!mpReady && !camError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-navy-900/80 gap-3">
            <div className="w-10 h-10 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-300">{loadingMsg}</p>
          </div>
        )}

        {camError && (
          <div className="absolute inset-0 flex items-center justify-center bg-navy-900/90">
            <p className="text-sm text-red-400 text-center px-6">{camError}</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="w-64 flex flex-col gap-3 shrink-0">
        {/* Target letter */}
        <div className="bg-navy-800 rounded-2xl p-5 border border-navy-700/60 shadow-lg flex flex-col items-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-3 font-semibold">Sign this letter</p>
          <span
            className="text-9xl font-bold text-white leading-none"
            style={{ fontFamily: "'Fira Code', monospace" }}
          >
            {practiceTarget || "…"}
          </span>
          <p className="text-xs text-slate-500 mt-3">Hold still for ~{(HOLD_FRAMES / 30).toFixed(1)}s</p>
        </div>

        {/* Mastery */}
        <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 shadow">
          <div className="flex justify-between text-xs mb-2">
            <span className="text-slate-400">Mastery</span>
            <span className="text-teal-400 font-bold">{practiceMastery}%</span>
          </div>
          <div className="h-2 bg-navy-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-500 rounded-full transition-all duration-500"
              style={{ width: `${practiceMastery}%` }}
            />
          </div>
        </div>

        {/* Skip */}
        <button
          onClick={() => handleResult(false)}
          disabled={!practiceTarget || !!feedback}
          className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-navy-700 hover:bg-navy-600 text-sm transition-colors cursor-pointer disabled:opacity-40 border border-navy-600"
        >
          Skip <ChevronRightIcon className="w-4 h-4" />
        </button>

        {/* Sign hint */}
        {practiceTarget && (
          <div className="bg-navy-800 rounded-2xl p-3 border border-navy-700/60 flex flex-col items-center shadow">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2 font-semibold">Reference</p>
            <img
              src={`/signs/${practiceTarget}.png`}
              alt={practiceTarget}
              className="w-28 h-28 object-contain"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          </div>
        )}
      </div>
    </div>
  );
}
