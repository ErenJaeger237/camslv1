import { useRef, useState, useCallback } from "react";
import { speak } from "../lib/tts";
import { VolumeIcon } from "./icons";
import { Hand3D } from "./Hand3D";

const KNOWN_LETTERS = new Set("ABCDEFGHIKLMNOPQRSTUVWXY".split(""));
const DELAY_MS = 900;
// Neutral letter shown when idle / during spaces
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
    <div className="p-4 flex gap-4 h-full">
      {/* Controls */}
      <div className="w-80 flex flex-col gap-3 shrink-0">
        <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 shadow-lg">
          <label className="text-[10px] text-slate-500 uppercase tracking-widest block mb-2.5 font-semibold">
            Type text to display as signs
          </label>
          <textarea
            className="w-full bg-navy-900 text-white rounded-xl p-3 text-sm resize-none border border-navy-600 focus:border-teal-500 focus:outline-none h-32 transition-colors"
            placeholder="Hello world…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={playing ? handleStop : () => playSequence(input)}
            disabled={!input.trim()}
            className="flex-1 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-40 disabled:cursor-not-allowed text-navy-950 font-semibold text-sm transition-all duration-200 cursor-pointer shadow-lg shadow-teal-900/30"
          >
            {playing ? "⏹ Stop" : "▶ Show Signs"}
          </button>
          <button
            onClick={() => input.trim() && speak(input)}
            disabled={!input.trim()}
            className="w-11 flex items-center justify-center rounded-xl bg-navy-700 hover:bg-navy-600 transition-colors cursor-pointer border border-navy-600 disabled:opacity-40"
          >
            <VolumeIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 text-xs text-slate-400 space-y-1.5">
          <p className="text-slate-200 font-semibold text-sm mb-1">How it works</p>
          <p>The 3D hand signs each letter for {DELAY_MS / 1000}s, animating smoothly between them.</p>
          <p>Spaces create brief pauses. J and Z are excluded (motion signs).</p>
        </div>
      </div>

      {/* 3D sign display */}
      <div className="flex-1 relative bg-navy-900 rounded-2xl border border-navy-700/60 shadow-xl overflow-hidden">
        <Hand3D letter={currentChar} />

        {/* Current letter badge — bottom centre */}
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className={`px-6 py-2 rounded-2xl border backdrop-blur-sm transition-colors duration-300 ${
            isIdle
              ? "bg-navy-800/70 border-navy-600/40"
              : "bg-teal-900/70 border-teal-500/50 shadow-lg shadow-teal-900/30"
          }`}>
            <span
              className={`text-5xl font-bold leading-none ${isIdle ? "text-slate-500" : "text-teal-300"}`}
              style={{ fontFamily: "'Fira Code', monospace" }}
            >
              {isIdle ? "—" : currentChar}
            </span>
          </div>
        </div>

        {/* Idle hint */}
        {isIdle && !playing && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none">
            <span className="text-[11px] text-slate-600 uppercase tracking-widest">
              Type text and press Show Signs
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
