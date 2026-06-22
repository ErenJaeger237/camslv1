import { useRef, useState, useCallback } from "react";
import { speak } from "../lib/tts";

const SIGN_IMAGES = "ABCDEFGHIKLMNOPQRSTUVWXY".split("");
const DELAY_MS = 800;

export function TextToSign() {
  const [input, setInput] = useState("");
  const [playing, setPlaying] = useState(false);
  const [currentChar, setCurrentChar] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const playSequence = useCallback((text: string) => {
    const chars = text
      .toUpperCase()
      .split("")
      .filter((c) => SIGN_IMAGES.includes(c) || c === " ");
    if (!chars.length) return;

    setPlaying(true);
    let i = 0;

    const step = () => {
      if (i >= chars.length) {
        setCurrentChar(null);
        setPlaying(false);
        return;
      }
      const ch = chars[i++];
      setCurrentChar(ch === " " ? null : ch);
      timerRef.current = setTimeout(step, ch === " " ? DELAY_MS / 2 : DELAY_MS);
    };
    step();
  }, []);

  const handlePlay = () => {
    clearTimeout(timerRef.current);
    playSequence(input);
  };

  const handleStop = () => {
    clearTimeout(timerRef.current);
    setPlaying(false);
    setCurrentChar(null);
  };

  const handleSpeak = () => {
    if (input.trim()) speak(input);
  };

  return (
    <div className="p-4 flex gap-4 h-full">
      {/* Left — input */}
      <div className="w-80 flex flex-col gap-3">
        <div className="bg-navy-800 rounded-xl p-4 border border-navy-700">
          <label className="text-xs text-slate-500 uppercase tracking-wider block mb-2">
            Type text to show as signs
          </label>
          <textarea
            className="w-full bg-navy-900 text-white rounded-lg p-3 text-sm resize-none border border-navy-600 focus:border-teal-500 focus:outline-none h-32"
            placeholder="Hello world…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={playing ? handleStop : handlePlay}
            disabled={!input.trim()}
            className="flex-1 py-2 rounded-lg bg-teal-500 hover:bg-teal-400 disabled:opacity-40 text-navy-950 font-semibold text-sm transition-colors"
          >
            {playing ? "⏹ Stop" : "▶ Show Signs"}
          </button>
          <button
            onClick={handleSpeak}
            disabled={!input.trim()}
            className="px-3 py-2 rounded-lg bg-navy-700 hover:bg-navy-600 text-sm transition-colors disabled:opacity-40"
          >
            🔊
          </button>
        </div>

        <div className="bg-navy-800 rounded-xl p-3 border border-navy-700 text-xs text-slate-400">
          <p className="font-semibold text-slate-300 mb-1">Tips</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>Only A–Y (no J or Z — they need motion)</li>
            <li>Spaces become brief pauses</li>
            <li>Each letter shows for {DELAY_MS / 1000}s</li>
          </ul>
        </div>
      </div>

      {/* Right — sign display */}
      <div className="flex-1 flex items-center justify-center bg-navy-800 rounded-xl border border-navy-700">
        {currentChar ? (
          <div className="text-center">
            <img
              src={`/signs/${currentChar}.png`}
              alt={`Sign for ${currentChar}`}
              className="w-64 h-64 object-contain mx-auto"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            <p className="text-7xl font-bold text-teal-400 mt-4">{currentChar}</p>
          </div>
        ) : (
          <div className="text-center text-slate-600">
            <p className="text-6xl mb-4">👋</p>
            <p className="text-sm">Signs will appear here</p>
          </div>
        )}
      </div>
    </div>
  );
}
