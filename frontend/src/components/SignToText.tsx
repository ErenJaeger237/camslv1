/**
 * SignToText.tsx — webcam panel that runs MediaPipe + TF.js in the browser.
 *
 * Architecture:
 *  - <video> element captures webcam via getUserMedia
 *  - requestAnimationFrame loop calls MediaPipe detect() each frame
 *  - Normalised landmarks fed to TF.js predict()
 *  - WordBuilder accumulates stable predictions into words/sentences
 *  - Autocomplete suggestions fetched from FastAPI when word prefix changes
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaPipe } from "../hooks/useMediaPipe";
import { useInference } from "../hooks/useInference";
import { WordBuilder } from "../lib/wordBuilder";
import { normaliseLandmarks } from "../lib/landmarks";
import { speak } from "../lib/tts";
import { getAutocomplete } from "../lib/api";
import { useAppStore } from "../store/appStore";
import { cn } from "../lib/utils";

const builder = new WordBuilder();

export function SignToText() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const [camError, setCamError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const fpsCounterRef = useRef({ frames: 0, last: performance.now() });

  const { ready: mpReady, error: mpError, detect } = useMediaPipe();
  const { ready: tfReady, predict } = useInference();

  const { setSignResult, setSuggestions, suggestions } = useAppStore();
  const [localWord, setLocalWord] = useState("");
  const [localSentence, setLocalSentence] = useState("");
  const [localLetter, setLocalLetter] = useState("");
  const [localConf, setLocalConf] = useState(0);

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
        setCamError("Could not access webcam: " + String(e));
      }
    })();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const lastWordRef = useRef("");
  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop);

    const video = videoRef.current;
    if (!video || video.readyState < 2 || !mpReady) return;

    // FPS counter
    const now = performance.now();
    fpsCounterRef.current.frames++;
    if (now - fpsCounterRef.current.last >= 1000) {
      setFps(fpsCounterRef.current.frames);
      fpsCounterRef.current = { frames: 0, last: now };
    }

    const { landmarks } = detect(video);

    let pred = null;
    if (landmarks && tfReady) {
      const features = normaliseLandmarks(landmarks);
      pred = predict(features);
    }

    const committed = builder.update(
      pred?.letter ?? null,
      pred?.confidence ?? 0,
    );

    const word = builder.currentWord;
    const sentence = builder.sentence;
    const letter = pred?.letter ?? "";
    const conf = pred?.confidence ?? 0;

    setLocalLetter(letter);
    setLocalConf(conf);
    setLocalWord(word);
    setLocalSentence(sentence);
    setSignResult(letter, conf, word, sentence);

    // Fetch autocomplete when the word changes
    if (committed || word !== lastWordRef.current) {
      lastWordRef.current = word;
      if (word.length >= 2) {
        getAutocomplete(word)
          .then((r) => {
            builder.setSuggestions(r.suggestions);
            setSuggestions(r.suggestions);
          })
          .catch(() => {});
      } else {
        builder.setSuggestions([]);
        setSuggestions([]);
      }
    }
  }, [mpReady, tfReady, detect, predict, setSignResult, setSuggestions]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loop]);

  const handleClear = () => {
    builder.clear();
    setLocalWord("");
    setLocalSentence("");
    setLocalLetter("");
    setLocalConf(0);
    setSuggestions([]);
    setSignResult("", 0, "", "");
  };

  const handleBackspace = () => {
    builder.backspace();
    setLocalWord(builder.currentWord);
    setLocalSentence(builder.sentence);
  };

  const handleSpeak = () => {
    const text = builder.fullText;
    if (text) speak(text);
  };

  const handleSuggestion = (word: string) => {
    builder.acceptSuggestion(word);
    setLocalWord(builder.currentWord);
    setLocalSentence(builder.sentence);
    setSuggestions([]);
  };

  const fullText = (localSentence + localWord).trim();

  return (
    <div className="flex gap-4 p-4 h-full">
      {/* Left — webcam */}
      <div className="flex-1 flex flex-col gap-3">
        <div className="relative rounded-xl overflow-hidden bg-navy-800 aspect-video">
          <video
            ref={videoRef}
            className="w-full h-full object-cover scale-x-[-1]"
            muted
            playsInline
          />
          {/* Overlays */}
          <div className="absolute top-2 left-2 flex gap-2">
            <span className="bg-black/60 text-xs px-2 py-0.5 rounded-full text-slate-300">
              {fps} fps
            </span>
            {mpReady && (
              <span className="bg-teal-600/80 text-xs px-2 py-0.5 rounded-full">
                MediaPipe ✓
              </span>
            )}
            {tfReady && (
              <span className="bg-teal-600/80 text-xs px-2 py-0.5 rounded-full">
                TF.js ✓
              </span>
            )}
          </div>

          {/* Current letter badge */}
          {localLetter && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center">
              <span className="text-6xl font-bold text-teal-400 drop-shadow-lg">
                {localLetter}
              </span>
              <div className="w-32 h-1.5 bg-navy-800 rounded-full overflow-hidden mt-1">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    localConf > 0.9 ? "bg-teal-400" : localConf > 0.7 ? "bg-yellow-400" : "bg-red-400",
                  )}
                  style={{ width: `${localConf * 100}%` }}
                />
              </div>
            </div>
          )}

          {(camError || mpError) && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-red-400 text-sm p-4 text-center">
              {camError ?? mpError}
            </div>
          )}

          {!mpReady && !mpError && !camError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-sm text-slate-300">Loading MediaPipe…</p>
              </div>
            </div>
          )}
        </div>

        {/* Autocomplete */}
        {suggestions.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => handleSuggestion(s)}
                className="px-3 py-1 bg-navy-700 hover:bg-teal-600 text-sm rounded-lg transition-colors border border-navy-600"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right — text output */}
      <div className="w-80 flex flex-col gap-3">
        {/* Current word */}
        <div className="bg-navy-800 rounded-xl p-4 border border-navy-700">
          <p className="text-xs text-slate-500 mb-1 uppercase tracking-wider">Current Word</p>
          <p className="text-3xl font-mono text-teal-400 min-h-[2.5rem]">
            {localWord || <span className="text-slate-600">…</span>}
          </p>
        </div>

        {/* Full text */}
        <div className="bg-navy-800 rounded-xl p-4 border border-navy-700 flex-1">
          <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider">Text</p>
          <p className="text-base text-white leading-relaxed min-h-[4rem] break-words">
            {localSentence}
            {localWord && (
              <span className="text-teal-400">{localWord}</span>
            )}
            {!fullText && <span className="text-slate-600">Start signing…</span>}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleSpeak}
            disabled={!fullText}
            className="flex-1 py-2 rounded-lg bg-teal-500 hover:bg-teal-400 disabled:opacity-40 disabled:cursor-not-allowed text-navy-950 font-semibold text-sm transition-colors"
          >
            🔊 Speak
          </button>
          <button
            onClick={handleBackspace}
            className="px-3 py-2 rounded-lg bg-navy-700 hover:bg-navy-600 text-sm transition-colors"
          >
            ⌫
          </button>
          <button
            onClick={handleClear}
            className="px-3 py-2 rounded-lg bg-navy-700 hover:bg-red-900 text-sm transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Sign reference strip */}
        <div className="bg-navy-800 rounded-xl p-3 border border-navy-700">
          <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider">Sign Reference</p>
          <div className="grid grid-cols-6 gap-1">
            {"ABCDEFGHIKLMNOPQRSTUVWXY".split("").map((l) => (
              <button
                key={l}
                className="aspect-square flex items-center justify-center text-xs font-mono rounded bg-navy-700 hover:bg-teal-700 transition-colors"
                title={l}
                onClick={() => speak(l)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
