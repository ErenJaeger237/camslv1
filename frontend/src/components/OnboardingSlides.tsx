import { useState } from "react";
import { useAppStore } from "../store/appStore";
import { cn } from "../lib/utils";

interface Slide {
  icon: React.ReactNode;
  tag: string;
  title: string;
  body: string;
  accent: string;
  accentBg: string;
}

function HandIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2" />
      <path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2" />
      <path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

const SLIDES: Slide[] = [
  {
    tag: "About this project",
    title: "Welcome to CamSL Translator",
    body: "A final-year undergraduate tool bridging communication between deaf and hearing communities. Built with MediaPipe, TensorFlow, and AI — running entirely offline on your laptop, no cloud required.",
    icon: <HandIcon />,
    accent: "#3ddbd9",
    accentBg: "rgba(61,219,217,0.1)",
  },
  {
    tag: "Sign → Text",
    title: "Your Camera Reads Your Signs",
    body: "Hold your hand in front of the webcam. The AI recognises letters A–Y as you sign them, automatically building words and sentences — then speaks them aloud with one click.",
    icon: <CameraIcon />,
    accent: "#3b82f6",
    accentBg: "rgba(59,130,246,0.1)",
  },
  {
    tag: "Text → Sign & AI Chat",
    title: "Communicate in Both Directions",
    body: "Type or speak any text to see the matching sign images in sequence. The AI Chat assistant lets you hold a full conversation entirely through sign language.",
    icon: <ChatIcon />,
    accent: "#8b5cf6",
    accentBg: "rgba(139,92,246,0.1)",
  },
  {
    tag: "Practice & Learn",
    title: "Improve With Spaced Repetition",
    body: "Practice mode tracks your accuracy per letter and surfaces the ones you find hardest more often. The more you use it, the smarter it gets about what you need to review.",
    icon: <TargetIcon />,
    accent: "#22c55e",
    accentBg: "rgba(34,197,94,0.1)",
  },
];

export function OnboardingSlides() {
  const { completeOnboarding, username } = useAppStore();
  const [idx, setIdx] = useState(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");

  const slide = SLIDES[idx];
  const isLast = idx === SLIDES.length - 1;

  function go(next: number) {
    setDirection(next > idx ? "forward" : "back");
    setIdx(next);
  }

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col items-center justify-center p-6 select-none">

      {/* Skip */}
      <button
        onClick={completeOnboarding}
        className="absolute top-6 right-6 text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer font-mono"
      >
        Skip →
      </button>

      {/* Step dots */}
      <div className="flex gap-2 mb-12">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            onClick={() => go(i)}
            className="rounded-full transition-all duration-300 cursor-pointer"
            style={{
              width: i === idx ? 24 : 8,
              height: 8,
              background: i === idx ? slide.accent : "#162d44",
            }}
          />
        ))}
      </div>

      {/* Card */}
      <div
        key={idx}
        className="w-full max-w-md rounded-3xl border p-10 flex flex-col items-center text-center"
        style={{
          background: "linear-gradient(160deg, #0d1b2a 0%, #112235 100%)",
          borderColor: "rgba(255,255,255,0.07)",
          boxShadow: `0 0 60px ${slide.accentBg}, 0 30px 80px rgba(0,0,0,0.4)`,
          animation: `slide-${direction} 0.3s ease`,
        }}
      >
        {/* Icon */}
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center mb-6"
          style={{
            background: slide.accentBg,
            color: slide.accent,
            border: `1px solid ${slide.accent}30`,
          }}
        >
          {slide.icon}
        </div>

        {/* Tag */}
        <span
          className="text-xs uppercase tracking-widest font-semibold mb-3 font-mono"
          style={{ color: slide.accent }}
        >
          {slide.tag}
        </span>

        {/* Title */}
        <h2 className="text-2xl font-bold text-white mb-4 leading-tight">
          {slide.title}
        </h2>

        {/* Body */}
        <p className="text-sm text-slate-400 leading-relaxed max-w-sm">
          {slide.body}
        </p>

        {/* Slide number */}
        <p className="mt-8 text-xs text-slate-600 font-mono">
          {idx + 1} / {SLIDES.length}
        </p>
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-4 mt-8">
        {idx > 0 && (
          <button
            onClick={() => go(idx - 1)}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-400 border border-navy-700 hover:border-slate-600 hover:text-white transition-all cursor-pointer"
          >
            ← Back
          </button>
        )}

        {isLast ? (
          <button
            onClick={completeOnboarding}
            className="px-8 py-3 rounded-xl text-sm font-bold text-navy-950 transition-all cursor-pointer shadow-lg"
            style={{
              background: "linear-gradient(135deg, #3ddbd9, #1ea8a6)",
              boxShadow: "0 0 20px rgba(61,219,217,0.3)",
            }}
          >
            {username ? `Let's go, ${username}!` : "Get started →"}
          </button>
        ) : (
          <button
            onClick={() => go(idx + 1)}
            className="px-8 py-3 rounded-xl text-sm font-bold transition-all cursor-pointer"
            style={{
              background: slide.accentBg,
              color: slide.accent,
              border: `1px solid ${slide.accent}40`,
            }}
          >
            Next →
          </button>
        )}
      </div>

      <style>{`
        @keyframes slide-forward {
          from { opacity: 0; transform: translateX(30px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes slide-back {
          from { opacity: 0; transform: translateX(-30px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
