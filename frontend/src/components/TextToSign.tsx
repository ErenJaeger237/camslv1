import { useRef, useState, useCallback } from "react";
import { speak } from "../lib/tts";
import { VolumeIcon } from "./icons";
import { Hand3D } from "./Hand3D";

const KNOWN_LETTERS = new Set("ABCDEFGHIKLMNOPQRSTUVWXY".split(""));
const DELAY_MS = 900;
const IDLE_LETTER = "B";

export function TextToSign() {
  const [input, setInput] = useState("");
  const [playing, setPlaying] = useState(false);
  const [currentChar, setCurrentChar] = useState<string>(IDLE_LETTER);
  const [isIdle, setIsIdle] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const playSequence = useCallback((text: string) => {
    const chars = text.toUpperCase().split("").filter((c) => KNOWN_LETTERS.has(c) || c === " ");
    if (!chars.length) return;
    setPlaying(true);
    setIsIdle(false);
    let i = 0;
    const step = () => {
      if (i >= chars.length) {
        setIsIdle(true);
        setCurrentChar(IDLE_LETTER);
        setPlaying(false);
        return;
      }
      const ch = chars[i++];
      if (ch !== " ") setCurrentChar(ch);
      timerRef.current = setTimeout(step, ch === " " ? DELAY_MS / 2 : DELAY_MS);
    };
    step();
  }, []);

  const handleStop = () => {
    clearTimeout(timerRef.current);
    setPlaying(false);
    setIsIdle(true);
    setCurrentChar(IDLE_LETTER);
  };

  return (
    <div className="p-6 flex gap-6 h-full">

      {/* ── Controls column ── */}
      <div className="w-80 flex flex-col gap-4 shrink-0">

        {/* Input card */}
        <div className="glass-card p-5">
          <label className="label-xs block mb-3">
            Type text to display as signs
          </label>
          <textarea
            className="w-full bg-navy-900/60 text-white rounded-xl p-3.5 text-sm resize-none
                       border border-white/8 focus:border-teal-500/60 focus:outline-none
                       focus:shadow-[0_0_0_3px_rgba(45,212,191,0.12)]
                       h-32 transition-all duration-300 placeholder:text-slate-600"
            placeholder="Hello world…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>

        {/* Action buttons — primary + secondary */}
        <div className="flex gap-3">
          {/* PRIMARY */}
          <button
            onClick={playing ? handleStop : () => playSequence(input)}
            disabled={!input.trim()}
            className="btn-primary flex-1"
          >
            {playing ? "⏹ Stop" : "▶ Show Signs"}
          </button>
          {/* SECONDARY */}
          <button
            onClick={() => input.trim() && speak(input)}
            disabled={!input.trim()}
            title="Read aloud"
            className="btn-ghost w-12 px-0"
          >
            <VolumeIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Info card */}
        <div className="glass-card p-4 text-xs text-slate-400 space-y-2 leading-relaxed">
          <p className="text-slate-200 font-semibold text-sm">How it works</p>
          <p>The 3D hand signs each letter for {DELAY_MS / 1000}s, animating smoothly between them.</p>
          <p>Spaces create brief pauses. J and Z are excluded (motion signs).</p>
        </div>
      </div>

      {/* ── 3D sign display ── */}
      <div className="flex-1 relative bg-navy-900 rounded-2xl border border-white/8 shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_16px_48px_rgba(0,0,0,0.5)] overflow-hidden">
        <Hand3D letter={currentChar} />

        {/* Current letter badge — bottom centre */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className={`px-7 py-3 rounded-2xl border backdrop-blur-xl transition-all duration-300 ${
            isIdle
              ? "bg-navy-900/60 border-white/8"
              : "bg-teal-950/70 border-teal-500/40 shadow-[0_0_24px_rgba(45,212,191,0.25)]"
          }`}>
            <span
              className={`text-5xl font-bold leading-none ${isIdle ? "text-slate-600" : "text-teal-300"}`}
              style={{ fontFamily: "'Fira Code', monospace" }}
            >
              {isIdle ? "—" : currentChar}
            </span>
          </div>
        </div>

        {/* Idle hint */}
        {isIdle && !playing && (
          <div className="absolute top-5 left-1/2 -translate-x-1/2 pointer-events-none">
            <span className="text-[10px] text-slate-600 uppercase tracking-[0.15em]">
              Type text and press Show Signs
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
