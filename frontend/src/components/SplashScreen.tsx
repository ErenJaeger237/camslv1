import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/appStore";

const STEPS = [
  "Loading sign recognition models…",
  "Initialising MediaPipe…",
  "Starting camera…",
  "Ready!",
];

export function SplashScreen() {
  const { finishSplash } = useAppStore();
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    const TOTAL_MS = 2600;
    const start = Date.now();

    const tickInterval = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min((elapsed / TOTAL_MS) * 100, 100);
      setProgress(pct);
      const stepIdx = Math.min(Math.floor((pct / 100) * STEPS.length), STEPS.length - 1);
      setStep(stepIdx);
    }, 30);

    const finishTimer = setTimeout(() => {
      clearInterval(tickInterval);
      setProgress(100);
      setStep(STEPS.length - 1);

      setTimeout(() => {
        if (!doneRef.current) {
          doneRef.current = true;
          setFadeOut(true);
          setTimeout(finishSplash, 400);
        }
      }, 500);
    }, TOTAL_MS);

    return () => {
      clearInterval(tickInterval);
      clearTimeout(finishTimer);
    };
  }, [finishSplash]);

  return (
    <div
      className="min-h-screen bg-navy-950 flex flex-col items-center justify-center select-none"
      style={{
        opacity: fadeOut ? 0 : 1,
        transition: "opacity 0.4s ease",
      }}
    >
      {/* Glow rings */}
      <div className="relative mb-10">
        <div
          className="absolute inset-0 rounded-full bg-teal-500/10"
          style={{
            width: 160,
            height: 160,
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            animation: "pulse-ring 2s ease-in-out infinite",
          }}
        />
        <div
          className="absolute rounded-full bg-teal-500/6"
          style={{
            width: 220,
            height: 220,
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            animation: "pulse-ring 2s ease-in-out 0.4s infinite",
          }}
        />

        {/* Logo box */}
        <div
          className="relative w-24 h-24 rounded-3xl flex items-center justify-center shadow-2xl"
          style={{
            background: "linear-gradient(135deg, #3ddbd9 0%, #1ea8a6 100%)",
            boxShadow: "0 0 40px rgba(61,219,217,0.35), 0 20px 60px rgba(0,0,0,0.5)",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className="w-12 h-12"
            fill="none"
            stroke="#070e1a"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2" />
            <path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2" />
            <path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8" />
            <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
          </svg>
        </div>
      </div>

      {/* Brand text */}
      <h1
        className="text-4xl font-bold text-white mb-2"
        style={{
          fontFamily: "'Fira Code', monospace",
          letterSpacing: "-0.02em",
        }}
      >
        CamSL Translator
      </h1>
      <p
        className="text-sm uppercase tracking-widest mb-14"
        style={{ color: "rgba(61,219,217,0.6)" }}
      >
        Cameroon Sign Language Bridge
      </p>

      {/* Progress bar + step label */}
      <div className="w-64 flex flex-col items-center gap-3">
        <div className="w-full h-1 rounded-full bg-navy-700 overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${progress}%`,
              background: "linear-gradient(90deg, #3ddbd9, #2bc4c2)",
              transition: "width 0.06s linear",
            }}
          />
        </div>
        <p
          className="text-xs text-center font-mono"
          style={{
            color: "#64748b",
            minHeight: "1.2em",
            transition: "opacity 0.2s",
          }}
        >
          {STEPS[step]}
        </p>
      </div>

      {/* Version badge */}
      <div
        className="absolute bottom-8 text-xs font-mono"
        style={{ color: "#1e3a5f" }}
      >
        v1.0.0 — Final Year Project 2026
      </div>

      <style>{`
        @keyframes pulse-ring {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.5; }
          50%       { transform: translate(-50%, -50%) scale(1.08); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
