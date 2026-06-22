import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaPipe } from "../hooks/useMediaPipe";
import { useInference } from "../hooks/useInference";
import { normaliseLandmarks } from "../lib/landmarks";
import { initPractice, recordPracticeResult } from "../lib/api";
import { useAppStore } from "../store/appStore";
import { cn } from "../lib/utils";

const HOLD_FRAMES = 20;  // frames letter must be stable before auto-check

export function PracticeMode() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const { ready: mpReady, detect } = useMediaPipe();
  const { ready: tfReady, predict } = useInference();

  const { sessionId, practiceTarget, practiceMastery, setPracticeState, addPracticeResult } =
    useAppStore();

  const [camError, setCamError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const [detected, setDetected] = useState("");
  const [recentLetters, setRecentLetters] = useState<string[]>([]);
  const holdBufferRef = useRef<string[]>([]);
  const checkedRef = useRef(false);

  // Start webcam
  useEffect(() => {
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (e) {
        setCamError("Webcam error: " + String(e));
      }
    })();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Load first letter
  useEffect(() => {
    if (!practiceTarget) {
      initPractice(sessionId).then((r) => {
        setPracticeState(r.letter, r.mastery);
      });
    }
  }, [sessionId, practiceTarget, setPracticeState]);

  const handleResult = useCallback(
    async (correct: boolean) => {
      if (checkedRef.current) return;
      checkedRef.current = true;
      setFeedback(correct ? "correct" : "wrong");
      addPracticeResult(practiceTarget, correct);

      const newRecent = [...recentLetters.slice(-4), practiceTarget];
      setRecentLetters(newRecent);

      setTimeout(async () => {
        const r = await recordPracticeResult(sessionId, practiceTarget, correct, newRecent);
        setPracticeState(r.next_letter, r.mastery);
        setFeedback(null);
        setDetected("");
        holdBufferRef.current = [];
        checkedRef.current = false;
      }, 1200);
    },
    [practiceTarget, sessionId, recentLetters, addPracticeResult, setPracticeState],
  );

  // Inference loop
  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop);
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !mpReady || !practiceTarget || feedback) return;

    const { landmarks } = detect(video);
    if (!landmarks) { holdBufferRef.current = []; return; }

    const features = normaliseLandmarks(landmarks);
    const pred = tfReady ? predict(features) : null;
    if (!pred || pred.confidence < 0.85) { holdBufferRef.current = []; return; }

    setDetected(pred.letter);
    holdBufferRef.current.push(pred.letter);
    if (holdBufferRef.current.length > HOLD_FRAMES) holdBufferRef.current.shift();

    if (holdBufferRef.current.length === HOLD_FRAMES) {
      const allSame = holdBufferRef.current.every((l) => l === pred.letter);
      if (allSame) handleResult(pred.letter === practiceTarget);
    }
  }, [mpReady, tfReady, detect, predict, practiceTarget, feedback, handleResult]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loop]);

  return (
    <div className="flex gap-4 p-4 h-full">
      {/* Webcam */}
      <div className="flex-1 relative rounded-xl overflow-hidden bg-navy-800 aspect-video">
        <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" muted playsInline />

        {feedback && (
          <div
            className={cn(
              "absolute inset-0 flex items-center justify-center text-6xl font-bold",
              feedback === "correct" ? "bg-teal-500/70" : "bg-red-600/70",
            )}
          >
            {feedback === "correct" ? "✓" : "✗"}
          </div>
        )}

        {detected && !feedback && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-5xl font-bold text-teal-400">
            {detected}
          </div>
        )}

        {camError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-red-400 text-sm p-4 text-center">
            {camError}
          </div>
        )}
      </div>

      {/* Right — target + stats */}
      <div className="w-72 flex flex-col gap-3">
        {/* Target */}
        <div className="bg-navy-800 rounded-xl p-6 border border-navy-700 flex flex-col items-center">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Sign this letter</p>
          <p className="text-8xl font-bold text-white">{practiceTarget || "…"}</p>
          <p className="text-xs text-slate-500 mt-2">Hold for ~{HOLD_FRAMES / 30}s to confirm</p>
        </div>

        {/* Mastery */}
        <div className="bg-navy-800 rounded-xl p-4 border border-navy-700">
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>Overall Mastery</span>
            <span className="text-teal-400 font-semibold">{practiceMastery}%</span>
          </div>
          <div className="h-2 bg-navy-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-500 rounded-full transition-all duration-500"
              style={{ width: `${practiceMastery}%` }}
            />
          </div>
        </div>

        {/* Skip button */}
        <button
          onClick={() => handleResult(false)}
          disabled={!practiceTarget || !!feedback}
          className="py-2 rounded-lg bg-navy-700 hover:bg-navy-600 text-sm transition-colors disabled:opacity-40"
        >
          Skip →
        </button>

        {/* Hint — sign image */}
        {practiceTarget && (
          <div className="bg-navy-800 rounded-xl p-3 border border-navy-700 flex flex-col items-center">
            <p className="text-xs text-slate-500 mb-2">Reference</p>
            <img
              src={`/signs/${practiceTarget}.png`}
              alt={practiceTarget}
              className="w-32 h-32 object-contain"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          </div>
        )}
      </div>
    </div>
  );
}
