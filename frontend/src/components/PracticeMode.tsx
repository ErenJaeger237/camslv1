import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaPipe } from "../hooks/useMediaPipe";
import { useInference } from "../hooks/useInference";
import { normaliseLandmarks } from "../lib/landmarks";
import { drawSkeleton, clearCanvas } from "../lib/skeleton";
import { initPractice, recordPracticeResult, getPracticeTip } from "../lib/api";
import { useAppStore } from "../store/appStore";
import { cn } from "../lib/utils";
import { ChevronRightIcon } from "./icons";
import { Hand3D } from "./Hand3D";

const HOLD_FRAMES = 40;   // ~1.3 s at 30 fps — long enough to be deliberate
const MAX_ATTEMPTS = 3;   // wrong answers before advancing to next letter

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
  const [attempts, setAttempts] = useState(0);
  const [holdProgress, setHoldProgress] = useState(0);
  const [tipState, setTipState] = useState<{ text: string; signed: string; loading: boolean } | null>(null);
  const [tipCountdown, setTipCountdown] = useState(0);
  const advanceRef = useRef<(() => void) | null>(null);
  const holdRef = useRef<string[]>([]);
  const checkedRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (e) {
        if (!String(e).includes("AbortError")) setCamError("Webcam access denied.");
      }
    })();
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); cancelAnimationFrame(rafRef.current); };
  }, []);

  useEffect(() => {
    if (!practiceTarget) initPractice(sessionId).then((r) => setPracticeState(r.letter, r.mastery));
  }, [sessionId, practiceTarget, setPracticeState]);

  const resetAttempt = useCallback(() => {
    setFeedback(null);
    setDetected("");
    setHoldProgress(0);
    holdRef.current = [];
    checkedRef.current = false;
  }, []);

  const doAdvance = useCallback(async (newRecent: string[]) => {
    const r = await recordPracticeResult(sessionId, practiceTarget, false, newRecent);
    setPracticeState(r.next_letter, r.mastery);
    setAttempts(0);
    setTipState(null);
    setTipCountdown(0);
    resetAttempt();
  }, [sessionId, practiceTarget, setPracticeState, resetAttempt]);

  const handleResult = useCallback(async (correct: boolean, signedLetter: string) => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    setFeedback(correct ? "correct" : "wrong");
    addPracticeResult(practiceTarget, correct);

    const nextAttempts = correct ? 0 : attempts + 1;
    const shouldAdvance = correct || nextAttempts >= MAX_ATTEMPTS;

    if (correct) {
      const newRecent = [...recentLetters.slice(-4), practiceTarget];
      setRecentLetters(newRecent);
      setTimeout(async () => {
        const r = await recordPracticeResult(sessionId, practiceTarget, true, newRecent);
        setPracticeState(r.next_letter, r.mastery);
        setAttempts(0);
        resetAttempt();
      }, 1400);
    } else if (shouldAdvance) {
      // All attempts used — fetch tip then show review panel
      const newRecent = [...recentLetters.slice(-4), practiceTarget];
      setRecentLetters(newRecent);
      setTimeout(async () => {
        setFeedback(null);
        holdRef.current = [];
        setHoldProgress(0);
        // Show loading state immediately
        setTipState({ text: "", signed: signedLetter, loading: true });
        // Fetch tip (Gemini or static fallback)
        try {
          const { tip } = await getPracticeTip(practiceTarget, signedLetter);
          setTipState({ text: tip, signed: signedLetter, loading: false });
        } catch {
          setTipState({ text: `Check a reference for '${practiceTarget}' and compare your hand shape carefully.`, signed: signedLetter, loading: false });
        }
        // Auto-advance countdown (10 s)
        let remaining = 10;
        setTipCountdown(remaining);
        const advance = () => doAdvance(newRecent);
        advanceRef.current = advance;
        const ticker = setInterval(() => {
          remaining -= 1;
          setTipCountdown(remaining);
          if (remaining <= 0) { clearInterval(ticker); advance(); }
        }, 1000);
      }, 1400);
    } else {
      // Still have attempts left — reset and retry same letter
      setAttempts(nextAttempts);
      setTimeout(resetAttempt, 1600);
    }
  }, [practiceTarget, sessionId, recentLetters, attempts, addPracticeResult, setPracticeState, resetAttempt, doAdvance]);

  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop);
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !mpReady || !practiceTarget || feedback) return;
    const { landmarks } = detect(video);

    // Draw skeleton
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

    if (!landmarks) { holdRef.current = []; setHoldProgress(0); return; }
    const pred = tfReady ? predict(normaliseLandmarks(landmarks)) : null;
    if (!pred || pred.confidence < 0.85) { holdRef.current = []; setHoldProgress(0); return; }
    setDetected(pred.letter);
    holdRef.current.push(pred.letter);
    if (holdRef.current.length > HOLD_FRAMES) holdRef.current.shift();
    // Reset progress if the predicted letter changes mid-hold
    const allSame = holdRef.current.every((l) => l === pred.letter);
    const stableFrames = allSame ? holdRef.current.length : 0;
    if (!allSame) holdRef.current = [pred.letter];
    setHoldProgress(Math.round((stableFrames / HOLD_FRAMES) * 100));
    if (stableFrames === HOLD_FRAMES) {
      handleResult(pred.letter === practiceTarget, pred.letter);
    }
  }, [mpReady, tfReady, detect, predict, practiceTarget, feedback, handleResult]);

  useEffect(() => { rafRef.current = requestAnimationFrame(loop); return () => cancelAnimationFrame(rafRef.current); }, [loop]);

  return (
    <div className="relative flex gap-4 p-4 h-full">
      {/* Webcam */}
      <div className="flex-1 relative rounded-2xl overflow-hidden bg-navy-800 border border-navy-700/60 shadow-xl">
        <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" autoPlay muted playsInline />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

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
          <div className="absolute top-3 left-3">
            <span className="bg-yellow-900/80 backdrop-blur-sm text-[11px] px-2.5 py-1 rounded-lg text-yellow-300 border border-yellow-700/40 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
              {loadingMsg}
            </span>
          </div>
        )}

        {camError && (
          <div className="absolute inset-0 flex items-center justify-center bg-navy-900/90">
            <p className="text-sm text-red-400 text-center px-6">{camError}</p>
          </div>
        )}
      </div>

      {/* Tip overlay — shown after all attempts are exhausted */}
      {tipState && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-navy-950/90 backdrop-blur-sm rounded-2xl">
          <div
            className="w-full max-w-sm mx-6 rounded-2xl border p-6 flex flex-col gap-4"
            style={{
              background: "linear-gradient(160deg, #0d1b2a 0%, #112235 100%)",
              borderColor: "rgba(239,68,68,0.3)",
              boxShadow: "0 0 40px rgba(239,68,68,0.15), 0 20px 60px rgba(0,0,0,0.5)",
            }}
          >
            {/* Header */}
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔍</span>
              <div>
                <p className="text-sm font-bold text-white">Let's review what happened</p>
                <p className="text-xs text-slate-500">After 3 attempts on letter <span className="text-red-400 font-bold font-mono">{practiceTarget}</span></p>
              </div>
            </div>

            {/* What was signed vs target */}
            <div className="flex gap-3">
              <div className="flex-1 rounded-xl bg-red-950/40 border border-red-800/40 p-3 text-center">
                <p className="text-[10px] text-red-400 uppercase tracking-widest mb-1">You signed</p>
                <p className="text-3xl font-bold text-red-300 font-mono">{tipState.signed}</p>
              </div>
              <div className="flex items-center text-slate-600 text-lg">→</div>
              <div className="flex-1 rounded-xl bg-teal-950/40 border border-teal-700/40 p-3 text-center">
                <p className="text-[10px] text-teal-400 uppercase tracking-widest mb-1">Target</p>
                <p className="text-3xl font-bold text-teal-300 font-mono">{practiceTarget}</p>
              </div>
            </div>

            {/* Tip text */}
            <div className="rounded-xl bg-navy-800/60 border border-navy-700/60 p-4">
              {tipState.loading ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm">
                  <span className="w-3 h-3 rounded-full border-2 border-teal-500/40 border-t-teal-400 animate-spin inline-block" />
                  Analysing your attempt…
                </div>
              ) : (
                <p className="text-sm text-slate-300 leading-relaxed">{tipState.text}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-600 font-mono">
                Auto-advancing in {tipCountdown}s
              </span>
              <button
                onClick={() => { advanceRef.current?.(); }}
                className="px-5 py-2 rounded-xl text-sm font-bold text-navy-950 cursor-pointer"
                style={{ background: "linear-gradient(135deg, #3ddbd9, #1ea8a6)" }}
              >
                Got it, next →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="w-64 flex flex-col gap-2 shrink-0">

        {/* Compact header: letter + mastery + skip in one strip */}
        <div className="bg-navy-800 rounded-2xl px-4 py-3 border border-navy-700/60 shadow-lg shrink-0">
          <div className="flex items-center gap-3">
            {/* Big letter badge */}
            <span
              className="text-6xl font-bold text-white leading-none w-14 text-center"
              style={{ fontFamily: "'Fira Code', monospace" }}
            >
              {practiceTarget || "…"}
            </span>

            {/* Mastery + skip */}
            <div className="flex-1 flex flex-col gap-2">
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Mastery</span>
                <span className="text-teal-400 font-bold">{practiceMastery}%</span>
              </div>
              <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-teal-500 rounded-full transition-all duration-500"
                  style={{ width: `${practiceMastery}%` }}
                />
              </div>
              <button
                onClick={() => { setAttempts(MAX_ATTEMPTS - 1); handleResult(false, detected || "?"); }}
                disabled={!practiceTarget || !!feedback}
                className="flex items-center justify-center gap-1 py-1 rounded-lg bg-navy-700 hover:bg-navy-600 text-xs transition-colors cursor-pointer disabled:opacity-40 border border-navy-600"
              >
                Skip <ChevronRightIcon className="w-3 h-3" />
              </button>
            </div>
          </div>
          {/* Hold progress bar */}
          <div className="mt-3">
            <div className="flex justify-between text-[10px] text-slate-500 mb-1">
              <span>Hold steady</span>
              <span className="font-mono">{holdProgress}%</span>
            </div>
            <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-75"
                style={{
                  width: `${holdProgress}%`,
                  background: holdProgress === 100 ? "#22c55e" : "#3ddbd9",
                }}
              />
            </div>
          </div>

          {/* Attempt dots */}
          {attempts > 0 && (
            <div className="mt-2 flex items-center justify-center gap-1.5">
              {Array.from({ length: MAX_ATTEMPTS }).map((_, i) => (
                <span
                  key={i}
                  className="w-2 h-2 rounded-full"
                  style={{ background: i < attempts ? "#ef4444" : "#162d44" }}
                />
              ))}
              <span className="text-[10px] text-slate-500 ml-1">
                {MAX_ATTEMPTS - attempts} attempt{MAX_ATTEMPTS - attempts !== 1 ? "s" : ""} left
              </span>
            </div>
          )}
        </div>

        {/* 3D hand reference — takes all remaining height */}
        {practiceTarget && (
          <div className="bg-navy-900 rounded-2xl border border-navy-700/60 flex flex-col shadow overflow-hidden flex-1 min-h-0">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold px-3 pt-2 pb-0 shrink-0">
              3D Reference
            </p>
            <div className="flex-1 min-h-0">
              <Hand3D letter={practiceTarget} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
