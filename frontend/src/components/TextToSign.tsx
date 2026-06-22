import { useRef, useState, useCallback } from "react";
import { speak } from "../lib/tts";
import { VolumeIcon } from "./icons";

const SIGN_IMAGES = "ABCDEFGHIKLMNOPQRSTUVWXY".split("");
const DELAY_MS = 800;

export function TextToSign() {
  const [input, setInput] = useState("");
  const [playing, setPlaying] = useState(false);
  const [currentChar, setCurrentChar] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const playSequence = useCallback((text: string) => {
    const chars = text.toUpperCase().split("").filter((c) => SIGN_IMAGES.includes(c) || c === " ");
    if (!chars.length) return;
    setPlaying(true);
    let i = 0;
    const step = () => {
      if (i >= chars.length) { setCurrentChar(null); setPlaying(false); return; }
      const ch = chars[i++];
      setCurrentChar(ch === " " ? null : ch);
      timerRef.current = setTimeout(step, ch === " " ? DELAY_MS / 2 : DELAY_MS);
    };
    step();
  }, []);

  const handleStop = () => { clearTimeout(timerRef.current); setPlaying(false); setCurrentChar(null); };

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
          <p>Each letter from A–Y appears as a sign image for {DELAY_MS / 1000}s.</p>
          <p>Spaces create brief pauses. J and Z are excluded (motion signs).</p>
        </div>
      </div>

      {/* Sign display */}
      <div className="flex-1 flex items-center justify-center bg-navy-800 rounded-2xl border border-navy-700/60 shadow-xl">
        {currentChar ? (
          <div className="flex flex-col items-center gap-4">
            <img
              src={`/signs/${currentChar}.png`}
              alt={`Sign for ${currentChar}`}
              className="w-64 h-64 object-contain drop-shadow-2xl"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <span
              className="text-8xl font-bold text-teal-400"
              style={{ fontFamily: "'Fira Code', monospace" }}
            >
              {currentChar}
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-slate-600">
            <div className="w-20 h-20 rounded-3xl bg-navy-700/60 border border-navy-600 flex items-center justify-center">
              <VolumeIcon className="w-8 h-8 text-slate-600" />
            </div>
            <p className="text-sm">Signs will appear here</p>
          </div>
        )}
      </div>
    </div>
  );
}
