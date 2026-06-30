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

const HOLD_FRAMES = 40;
const MAX_ATTEMPTS = 3;

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
      const newRecent = [...recentLetters.slice(-4), practiceTarget];
      setRecentLetters(newRecent);
      setTimeout(async () => {
        setFeedback(null);
        holdRef.current = [];
        setHoldProgress(0);
        setTipState({ text: "", signed: signedLetter, loading: true });
        try {
          const { tip } = await getPracticeTip(practiceTarget, signedLetter);
          setTipState({ text: tip, signed: signedLetter, loading: false });
        } catch {
          setTipState({ text: `Check a reference for '${practiceTarget}' and compare your hand shape carefully.`, signed: signedLetter, loading: false });
        }
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
      setAttempts(nextAttempts);
      setTimeout(resetAttempt, 1600);
    }
  }, [practiceTarget, sessionId, recentLetters, attempts, addPracticeResult, setPracticeState, resetAttempt, doAdvance]);

  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop);
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !mpReady || !practiceTarget || feedback) return;
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

    if (!landmarks) { holdRef.current = []; setHoldProgress(0); return; }
    const pred = tfReady ? predict(normaliseLandmarks(landmarks)) : null;
    if (!pred || pred.confidence < 0.85) { holdRef.current = []; setHoldProgress(0); return; }
    setDetected(pred.letter);
    holdRef.current.push(pred.letter);
    if (holdRef.current.length > HOLD_FRAMES) holdRef.current.shift();
    const allSame = holdRef.current.every((l) => l === pred.letter);
    const stableFrames = allSame ? holdRef.current.length : 0;
    if (!allSame) holdRef.current = [pred.letter];
    setHoldProgress(Math.round((stableFrames / HOLD_FRAMES) * 100));
    if (stableFrames === HOLD_FRAMES) {
      handleResult(pred.letter === practiceTarget, pred.letter);
    }
  }, [mpReady, tfReady, detect, predict, practiceTarget, feedback, handleResult]);

  useEffect(() => { rafRef.current = requestAnimationFrame(loop); return () => cancelAnimationFrame(rafRef.current); }, [loop]);

  // Status colour helper
  const statusColor = feedback === "correct"
    ? "text-emerald-400 bg-emerald-500/15 border-emerald-500/30"
    : feedback === "wrong"
      ? "text-red-400 bg-red-500/15 border-red-500/30"
      : holdProgress > 50
        ? "text-amber-400 bg-amber-500/15 border-amber-500/30"
        : "text-slate-400 bg-white/4 border-white/8";

  const statusText = feedback === "correct"
    ? "✓ Correct!"
    : feedback === "wrong"
      ? "✗ Try again"
      : holdProgress > 0
        ? "Hold steady…"
        : "Waiting for sign";

  return (
    <div className="relative flex gap-6 p-6 h-full">

      {/* ── Left: camera ── */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">

        {/* Target letter banner — MASSIVE and central above camera */}
        <div className="glass-card px-6 py-4 flex items-center justify-between">
          <div>
            <p className="label-xs mb-1">Sign to practice</p>
            <span
              className="text-8xl font-black text-white leading-none"
              style={{ fontFamily: "'Fira Code', monospace", textShadow: "0 0 40px rgba(45,212,191,0.5)" }}
            >
              {practiceTarget || "…"}
            </span>
          </div>

          {/* Status badge — colour coded */}
          <div className={cn("flex flex-col items-center gap-2 px-4 py-3 rounded-2xl border transition-all duration-500", statusColor)}>
            <span className="text-sm font-bold">{statusText}</span>
            {/* Mastery */}
            <div className="w-24">
              <div className="flex justify-between text-[9px] text-slate-500 mb-1">
                <span>Mastery</span>
                <span className="text-teal-400 font-bold">{practiceMastery}%</span>
              </div>
              <div className="h-1.5 bg-navy-900/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-teal-500 rounded-full transition-all duration-500"
                  style={{ width: `${practiceMastery}%` }}
                />
              </div>
            </div>
            {/* Skip */}
            <button
              onClick={() => { setAttempts(MAX_ATTEMPTS - 1); handleResult(false, detected || "?"); }}
              disabled={!practiceTarget || !!feedback}
              className="flex items-center gap-1 text-[10px] px-3 py-1 rounded-lg bg-white/6 hover:bg-white/10 border border-white/8 transition-colors cursor-pointer disabled:opacity-40"
            >
              Skip <ChevronRightIcon className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Camera feed */}
        <div className="relative flex-1 rounded-2xl overflow-hidden bg-navy-900 border border-white/8 shadow-[0_16px_48px_rgba(0,0,0,0.5)] min-h-0">
          <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" autoPlay muted playsInline />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

          {/* Feedback overlay */}
          {feedback && (
            <div className={cn(
              "absolute inset-0 flex flex-col items-center justify-center transition-all gap-3",
              feedback === "correct" ? "bg-emerald-500/50" : "bg-red-600/50"
            )}>
              <span className="text-8xl font-black text-white drop-shadow-lg" style={{ textShadow: "0 0 40px rgba(255,255,255,0.6)" }}>
                {feedback === "correct" ? "✓" : "✗"}
              </span>
              <span className="text-xl font-bold text-white/90 uppercase tracking-widest">
                {feedback === "correct" ? "Correct!" : "Wrong"}
              </span>
            </div>
          )}

          {/* Detected letter chip */}
          {detected && !feedback && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2">
              <div className="bg-navy-950/75 backdrop-blur-xl border border-white/10 rounded-2xl px-5 py-2 shadow-lg">
                <span className="text-5xl font-bold text-teal-400" style={{ fontFamily: "'Fira Code', monospace" }}>
                  {detected}
                </span>
              </div>
            </div>
          )}

          {/* Loading chip */}
          {!mpReady && !camError && (
            <div className="absolute top-4 left-4">
              <span className="bg-amber-900/70 backdrop-blur-md text-[10px] px-2.5 py-1 rounded-lg text-amber-300 border border-amber-700/30 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
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

        {/* Hold-progress bar */}
        <div className="glass-card px-5 py-3 flex items-center gap-4">
          <div className="flex-1">
            <div className="flex justify-between text-[10px] text-slate-500 mb-1.5">
              <span className="font-semibold">Hold steady</span>
              <span className="font-mono">{holdProgress}%</span>
            </div>
            <div className="h-2 bg-navy-900/60 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-75"
                style={{
                  width: `${holdProgress}%`,
                  background: holdProgress === 100 ? "#22c55e" : "linear-gradient(90deg, #3ddbd9, #2dd4bf)",
                }}
              />
            </div>
          </div>
          {/* Attempt dots */}
          {attempts > 0 && (
            <div className="flex items-center gap-1.5 shrink-0">
              {Array.from({ length: MAX_ATTEMPTS }).map((_, i) => (
                <span
                  key={i}
                  className="w-2.5 h-2.5 rounded-full transition-colors duration-300"
                  style={{ background: i < attempts ? "#ef4444" : "rgba(255,255,255,0.08)" }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: 3D reference ── */}
      {practiceTarget && (
        <div className="w-64 flex flex-col gap-4 shrink-0">
          <div className="glass-card overflow-hidden flex flex-col flex-1 min-h-0">
            <p className="label-xs px-4 pt-4 pb-0 shrink-0">3D Reference</p>
            <div className="flex-1 min-h-0">
              <Hand3D letter={practiceTarget} />
            </div>
          </div>
        </div>
      )}

      {/* ── Tip overlay ── */}
      {tipState && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-navy-950/90 backdrop-blur-sm rounded-2xl p-6">
          <div
            className="w-full max-w-sm rounded-2xl border p-6 flex flex-col gap-4"
            style={{
              background: "linear-gradient(160deg, #0d1b2a 0%, #112235 100%)",
              borderColor: "rgba(239,68,68,0.3)",
              boxShadow: "0 0 40px rgba(239,68,68,0.15), 0 20px 60px rgba(0,0,0,0.5)",
            }}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔍</span>
              <div>
                <p className="text-sm font-bold text-white">Let's review what happened</p>
                <p className="text-xs text-slate-500">After 3 attempts on letter <span className="text-red-400 font-bold font-mono">{practiceTarget}</span></p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 rounded-xl bg-red-950/40 border border-red-800/40 p-3 text-center">
                <p className="label-xs text-red-400 mb-1">You signed</p>
                <p className="text-3xl font-bold text-red-300 font-mono">{tipState.signed}</p>
              </div>
              <div className="flex items-center text-slate-600 text-lg">→</div>
              <div className="flex-1 rounded-xl bg-teal-950/40 border border-teal-700/40 p-3 text-center">
                <p className="label-xs text-teal-400 mb-1">Target</p>
                <p className="text-3xl font-bold text-teal-300 font-mono">{practiceTarget}</p>
              </div>
            </div>

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

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-600 font-mono">
                Auto-advancing in {tipCountdown}s
              </span>
              <button
                onClick={() => { advanceRef.current?.(); }}
                className="btn-primary px-5 py-2 text-sm"
              >
                Got it, next →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
