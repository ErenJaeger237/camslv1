import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaPipe } from "../hooks/useMediaPipe";
import { normaliseLandmarks, normaliseHandPair } from "../lib/landmarks";
import { drawSkeletonOnto, clearCanvas } from "../lib/skeleton";
import {
  addContribution, deleteLastContribution, getContributionCounts,
  addWordContribution, getWordContributionCounts, deleteLastWordContribution,
  triggerRetrain, getRetrainStatus,
  triggerWordRetrain, getWordRetrainStatus,
  uploadClip, getClipStats,
} from "../lib/api";
import { CameraIcon, XIcon } from "./icons";
import { cn } from "../lib/utils";

const LABELS = "ABCDEFGHIKLMNOPQRSTUVWXY".split("");
const AUTO_EVERY      = 25;
const WORD_AUTO_EVERY = 10;

const WORD_SIGNS = [
  { id: "hello",     label: "Hello" },
  { id: "thank_you", label: "Thank You" },
  { id: "yes",       label: "Yes" },
  { id: "no",        label: "No" },
  { id: "please",    label: "Please" },
  { id: "help",      label: "Help" },
  { id: "sorry",     label: "Sorry" },
  { id: "goodbye",   label: "Goodbye" },
  { id: "name",      label: "Name" },
  { id: "eat",       label: "Eat" },
  { id: "drink",     label: "Drink" },
  { id: "water",     label: "Water" },
  { id: "good",      label: "Good" },
  { id: "bad",       label: "Bad" },
  { id: "friend",    label: "Friend" },
];

const WORD_FRAMES = 30;

const CLIP_ALPHABET = "ABCDEFGHIKLMNOPQRSTUVWXY".split("");
const CLIP_WORD_SIGNS = [
  { id: "hello",     label: "Hello" },
  { id: "thank_you", label: "Thank You" },
  { id: "yes",       label: "Yes" },
  { id: "no",        label: "No" },
  { id: "please",    label: "Please" },
  { id: "help",      label: "Help" },
  { id: "sorry",     label: "Sorry" },
  { id: "goodbye",   label: "Goodbye" },
  { id: "name",      label: "Name" },
  { id: "eat",       label: "Eat" },
  { id: "drink",     label: "Drink" },
  { id: "water",     label: "Water" },
  { id: "good",      label: "Good" },
  { id: "bad",       label: "Bad" },
  { id: "friend",    label: "Friend" },
];
const SESSION_ID = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

function RetrainIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

export function DatasetPanel() {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const rafRef       = useRef<number>(0);
  const streamRef    = useRef<MediaStream | null>(null);
  const capturingRef = useRef(false);

  // ── Mode ────────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<"alphabet" | "word" | "clips">("alphabet");
  const modeRef = useRef<"alphabet" | "word" | "clips">("alphabet");
  modeRef.current = mode;

  // ── Alphabet state ──────────────────────────────────────────────────────────
  const [selectedLabel, setSelectedLabel] = useState("A");
  const [counts,        setCounts]        = useState<Record<string, number>>({});
  const [total,         setTotal]         = useState(0);
  const captureRef = useRef<Float32Array[]>([]);

  // ── Word-sign state ─────────────────────────────────────────────────────────
  const [selectedSign,   setSelectedSign]   = useState("hello");
  const [wordCounts,     setWordCounts]     = useState<Record<string, number>>({});
  const [wordFrameCount, setWordFrameCount] = useState(0);
  const [countdown,      setCountdown]      = useState<number | null>(null);
  const wordCaptureRef = useRef<Float32Array[]>([]);

  // ── Video Clip state ────────────────────────────────────────────────────────
  const [clipCategory,     setClipCategory]     = useState<"alphabet" | "word_signs">("alphabet");
  const [clipSign,         setClipSign]         = useState("A");
  const [clipContributor,  setClipContributor]  = useState("");
  const [clipRecording,    setClipRecording]    = useState(false);
  const [clipCountdown,    setClipCountdown]    = useState<number | null>(null);
  const [clipProgress,     setClipProgress]     = useState(0);   // 0–100
  const [clipUploadState,  setClipUploadState]  = useState<"idle"|"uploading"|"success"|"error">("idle");
  const [clipUploadMsg,    setClipUploadMsg]    = useState("");
  const [clipStats,        setClipStats]        = useState<Record<string, number>>({});
  const [clipStatsTotal,   setClipStatsTotal]   = useState(0);
  const recorderRef   = useRef<MediaRecorder | null>(null);
  const clipTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Shared UI ────────────────────────────────────────────────────────────────
  const [capturing,     setCapturing]     = useState(false);
  const [status,        setStatus]        = useState<{ msg: string; ok: boolean } | null>(null);
  const [handsDetected, setHandsDetected] = useState(0);

  // ── Retrain (alphabet) ───────────────────────────────────────────────────────
  const [retrainState, setRetrainState] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [retrainMsg,   setRetrainMsg]   = useState("");
  const [modelVersion, setModelVersion] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Retrain (word signs) ─────────────────────────────────────────────────────
  const [wordRetrainState, setWordRetrainState] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [wordRetrainMsg,   setWordRetrainMsg]   = useState("");
  const wordPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // numHands=2 always: one landmarker handles both modes, no reinit on mode switch.
  // detect() → first hand only (alphabet); detectAll() → both hands (word signs).
  const { ready: mpReady, loadingMsg, detectAll } = useMediaPipe(2);

  // ── Camera setup ─────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false }).catch(() => null);
      if (!stream) return;
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    })();
    getContributionCounts().then((r) => { setCounts(r.counts); setTotal(r.total); }).catch(() => {});
    getWordContributionCounts().then((r) => setWordCounts(r.counts)).catch(() => {});
    getRetrainStatus().then((r) => setModelVersion(r.version)).catch(() => {});
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      cancelAnimationFrame(rafRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      if (wordPollRef.current) clearInterval(wordPollRef.current);
    };
  }, []);

  // Load clip stats when entering clips tab
  useEffect(() => {
    if (mode !== "clips") return;
    getClipStats().then((r) => { setClipStats(r.counts); setClipStatsTotal(r.total); }).catch(() => {});
  }, [mode]);

  // ── Retrain polling ───────────────────────────────────────────────────────────
  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await getRetrainStatus();
        setRetrainState(r.state as "idle" | "running" | "done" | "failed");
        setRetrainMsg(r.message);
        if (r.state === "done" || r.state === "failed") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          if (r.state === "done" && r.version !== modelVersion) {
            setModelVersion(r.version);
            window.dispatchEvent(new CustomEvent("camsl:model-updated", { detail: { version: r.version } }));
          }
        }
      } catch { /* ignore */ }
    }, 2000);
  }, [modelVersion]);

  const startWordPolling = useCallback(() => {
    if (wordPollRef.current) return;
    wordPollRef.current = setInterval(async () => {
      try {
        const r = await getWordRetrainStatus();
        setWordRetrainState(r.state as "idle" | "running" | "done" | "failed");
        setWordRetrainMsg(r.message);
        if (r.state === "done" || r.state === "failed") {
          clearInterval(wordPollRef.current!);
          wordPollRef.current = null;
        }
      } catch { /* ignore */ }
    }, 2000);
  }, []);

  // ── RAF loop ─────────────────────────────────────────────────────────────────
  // Always calls detectAll (numHands=2) so BOTH hands are always visible on canvas.
  // Canvas is sized to display pixels (clientWidth/clientHeight) + object-cover math
  // in drawSkeletonOnto matches the skeleton to exactly where the video appears.
  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop);
    if (!mpReady) return;
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || video.readyState < 2 || !canvas) return;

    // Match canvas buffer to its CSS display size (not native video resolution)
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const ctx = canvas.getContext("2d")!;
    const vw  = video.videoWidth  || 640;
    const vh  = video.videoHeight || 480;

    // Detect both hands every frame
    const { hands } = detectAll(video);
    setHandsDetected(hands.length);

    // Draw all detected hands using the same style as Sign-to-Text
    clearCanvas(ctx, cw, ch);
    for (const hand of hands) {
      drawSkeletonOnto(ctx, hand.landmarks, cw, ch, vw, vh);
    }

    // Collect features during capture
    if (capturingRef.current && hands.length > 0) {
      if (modeRef.current === "alphabet") {
        // Alphabet: normalise the first detected hand (63 features)
        captureRef.current.push(normaliseLandmarks(hands[0].landmarks));
      } else {
        // Word-sign: normalise both hands together (126 features)
        if (wordCaptureRef.current.length < WORD_FRAMES) {
          wordCaptureRef.current.push(normaliseHandPair(hands));
          setWordFrameCount(wordCaptureRef.current.length);
          if (wordCaptureRef.current.length >= WORD_FRAMES) {
            capturingRef.current = false;
            setCapturing(false);
          }
        }
      }
    }
  }, [mpReady, detectAll]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loop]);

  // ── Alphabet capture ──────────────────────────────────────────────────────────
  const handleCapture = async () => {
    captureRef.current = [];
    capturingRef.current = true;
    setCapturing(true);
    setStatus(null);
    await new Promise((r) => setTimeout(r, 700));
    capturingRef.current = false;
    setCapturing(false);
    const frames = captureRef.current;
    if (frames.length < 1) { setStatus({ msg: "No hand detected — try again", ok: false }); return; }
    const avg = new Float32Array(63);
    for (const f of frames) f.forEach((v, i) => (avg[i] += v));
    avg.forEach((_, i) => (avg[i] /= frames.length));
    try {
      await addContribution(selectedLabel, Array.from(avg));
      const r = await getContributionCounts();
      setCounts(r.counts); setTotal(r.total);
      setStatus({ msg: `Saved "${selectedLabel}" — ${r.counts[selectedLabel] ?? 1} samples`, ok: true });
      if (r.total % AUTO_EVERY === 0) {
        setRetrainState("running"); setRetrainMsg("Auto-retraining started…"); startPolling();
      }
    } catch (e) { setStatus({ msg: "Error: " + String(e), ok: false }); }
  };

  // ── Word-sign capture: 3-2-1 countdown → collect 30 frames of 126 features ──
  const handleWordCapture = async () => {
    if (!mpReady || capturing || countdown !== null) return;
    setStatus(null);
    wordCaptureRef.current = [];
    setWordFrameCount(0);

    for (const n of [3, 2, 1]) {
      setCountdown(n);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setCountdown(null);
    capturingRef.current = true;
    setCapturing(true);

    // Poll until RAF loop fills 30 frames, with a 15-second safety timeout
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        capturingRef.current = false;
        setCapturing(false);
        clearInterval(check);
        resolve();
      }, 15_000);
      const check = setInterval(() => {
        if (!capturingRef.current) { clearTimeout(timer); clearInterval(check); resolve(); }
      }, 50);
    });

    const frames = wordCaptureRef.current;
    if (frames.length < 15) {
      setStatus({ msg: "Too few frames with hands detected — try again", ok: false });
      return;
    }
    try {
      const saved = await addWordContribution(selectedSign, frames.map((f) => Array.from(f)));
      const r = await getWordContributionCounts();
      setWordCounts(r.counts);
      const signCount = r.counts[selectedSign] ?? 1;
      const totalWord = Object.values(r.counts).reduce((a, b) => a + b, 0);
      setStatus({ msg: `Saved "${selectedSign}" — ${signCount} sample${signCount !== 1 ? "s" : ""}`, ok: true });
      // Mirror backend auto-trigger: show retrain state when threshold crossed
      if (saved && "total" in saved && (saved as any).total % WORD_AUTO_EVERY === 0) {
        setWordRetrainState("running");
        setWordRetrainMsg("Auto-retraining CamSL word-sign model…");
        startWordPolling();
      }
      void totalWord; // suppress unused warning
    } catch (e) { setStatus({ msg: "Error saving: " + String(e), ok: false }); }
  };

  // ── Video clip recording ──────────────────────────────────────────────────────
  const handleClipRecord = async () => {
    if (!streamRef.current || clipRecording || clipCountdown !== null) return;
    setClipUploadState("idle");
    setClipUploadMsg("");
    setClipProgress(0);

    // 3-2-1 countdown
    for (const n of [3, 2, 1]) {
      setClipCountdown(n);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setClipCountdown(null);

    // Start recording
    const chunks: Blob[] = [];
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
      ? "video/webm;codecs=vp8"
      : "video/webm";
    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const DURATION_MS = 4000;
    const startTime   = Date.now();
    setClipRecording(true);

    clipTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      setClipProgress(Math.min((elapsed / DURATION_MS) * 100, 100));
    }, 80);

    recorder.start(200);   // collect data every 200 ms
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      setTimeout(() => recorder.stop(), DURATION_MS);
    });

    if (clipTimerRef.current) { clearInterval(clipTimerRef.current); clipTimerRef.current = null; }
    setClipRecording(false);
    setClipProgress(100);

    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size < 200) {
      setClipUploadState("error");
      setClipUploadMsg("Recording too short or empty. Try again.");
      return;
    }

    setClipUploadState("uploading");
    setClipUploadMsg("Uploading to Supabase…");

    const fps = 30;
    const frameCount = Math.round((DURATION_MS / 1000) * fps);
    try {
      const res = await uploadClip(blob, {
        sign_name:        clipCategory === "alphabet" ? clipSign : clipSign,
        category:         clipCategory,
        meaning:          clipCategory === "alphabet"
                            ? `CamSL letter ${clipSign}`
                            : CLIP_WORD_SIGNS.find((s) => s.id === clipSign)?.label ?? clipSign,
        contributor_name: clipContributor.trim(),
        contributor_id:   SESSION_ID,
        frame_count:      frameCount,
        fps,
      });
      setClipUploadState("success");
      setClipUploadMsg(`Saved! ${(blob.size / 1024).toFixed(0)} KB uploaded.`);
      if (res.ok) {
        // Refresh stats
        getClipStats().then((r) => { setClipStats(r.counts); setClipStatsTotal(r.total); }).catch(() => {});
      }
    } catch (e) {
      setClipUploadState("error");
      setClipUploadMsg("Upload failed: " + String(e));
    }
  };

  const handleDelete = async () => {
    try {
      await deleteLastContribution();
      const c = await getContributionCounts();
      setCounts(c.counts); setTotal(c.total);
      setStatus({ msg: "Last alphabet sample deleted.", ok: true });
    } catch { setStatus({ msg: "Nothing to delete.", ok: false }); }
  };

  const handleDeleteWord = async () => {
    try {
      const r = await deleteLastWordContribution();
      const c = await getWordContributionCounts();
      setWordCounts(c.counts);
      setStatus({ msg: `Last "${r.sign}" sample deleted.`, ok: true });
    } catch { setStatus({ msg: "Nothing to delete.", ok: false }); }
  };

  const handleRetrain = async () => {
    try {
      await triggerRetrain();
      setRetrainState("running"); setRetrainMsg("Retraining started…"); startPolling();
    } catch (e) { setStatus({ msg: "Could not start retrain: " + String(e), ok: false }); }
  };

  const handleWordRetrain = async () => {
    try {
      await triggerWordRetrain();
      setWordRetrainState("running"); setWordRetrainMsg("Retraining CamSL word-sign model…"); startWordPolling();
    } catch (e) { setStatus({ msg: "Could not start word-sign retrain: " + String(e), ok: false }); }
  };

  const nextThreshold = AUTO_EVERY - (total % AUTO_EVERY || AUTO_EVERY);

  return (
    <div className="flex gap-4 p-4 h-full">

      {/* ── Webcam + skeleton overlay ── */}
      <div className="flex-1 relative rounded-2xl overflow-hidden bg-navy-900 border border-navy-700/60 shadow-xl">
        <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" autoPlay muted playsInline />
        {/* Canvas sized in CSS to fill container; pixel dims set in JS to clientWidth/Height */}
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

        {/* Capture pulse border */}
        {capturing && (
          <div className="absolute inset-0 border-4 border-teal-400 rounded-2xl animate-pulse pointer-events-none" />
        )}

        {/* Countdown overlay */}
        {countdown !== null && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-9xl font-black text-teal-400" style={{ textShadow: "0 0 40px #00f3ff" }}>
              {countdown}
            </span>
          </div>
        )}

        {/* Status chips — same style as Sign-to-Text */}
        <div className="absolute top-3 left-3 flex gap-2 flex-wrap">
          {mpReady ? (
            <span className="bg-teal-700/80 backdrop-blur-sm text-[11px] px-2.5 py-1 rounded-lg text-white border border-teal-500/40">
              {handsDetected > 0
                ? `${handsDetected} hand${handsDetected > 1 ? "s" : ""} detected`
                : "Hand detection ✓"}
            </span>
          ) : (
            <span className="bg-yellow-900/80 backdrop-blur-sm text-[11px] px-2.5 py-1 rounded-lg text-yellow-300 border border-yellow-700/40 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
              {loadingMsg}
            </span>
          )}
        </div>

        {/* Word-sign frame counter */}
        {mode === "word" && capturing && (
          <div className="absolute bottom-3 left-0 right-0 px-6">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-navy-900/80 rounded-full overflow-hidden">
                <div className="h-full bg-teal-400 rounded-full transition-all duration-75"
                  style={{ width: `${(wordFrameCount / WORD_FRAMES) * 100}%` }} />
              </div>
              <span className="text-xs text-teal-300 font-mono shrink-0">{wordFrameCount}/{WORD_FRAMES}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Controls ── */}
      <div className="w-72 flex flex-col gap-3 shrink-0 overflow-y-auto">

        {/* Mode toggle */}
        <div className="flex rounded-xl border border-navy-700/60 overflow-hidden bg-navy-800 shadow">
          {(["alphabet", "word", "clips"] as const).map((m) => (
            <button key={m} onClick={() => { setMode(m); setStatus(null); }}
              className={cn(
                "flex-1 py-2 text-xs font-semibold transition-colors cursor-pointer",
                mode === m ? "bg-teal-500 text-navy-950" : "text-slate-400 hover:text-slate-200"
              )}>
              {m === "alphabet" ? "Alphabet" : m === "word" ? "Word Signs" : "🎥 Video Clips"}
            </button>
          ))}
        </div>

        {/* ── ALPHABET MODE ─────────────────────────────────────────────────── */}
        {mode === "alphabet" && (
          <>
            <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 shadow-lg">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-3 font-semibold">Select Label</p>
              <div className="grid grid-cols-6 gap-1">
                {LABELS.map((l) => (
                  <button key={l} onClick={() => setSelectedLabel(l)}
                    className={cn(
                      "aspect-square flex items-center justify-center text-xs font-mono rounded-lg transition-all duration-150 cursor-pointer border",
                      selectedLabel === l
                        ? "bg-teal-500 text-navy-950 font-bold border-teal-400 shadow-lg"
                        : "bg-navy-700 hover:bg-navy-600 text-slate-300 border-navy-600"
                    )}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 shadow">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-300">
                  Samples for <span className="text-teal-400 font-bold font-mono">{selectedLabel}</span>
                </span>
                <span className="text-2xl font-bold text-white font-mono">{counts[selectedLabel] ?? 0}</span>
              </div>
              <div className="mt-2">
                <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                  <span>Total: {total}</span>
                  <span>Next retrain in {nextThreshold} samples</span>
                </div>
                <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden">
                  <div className="h-full bg-teal-500/60 rounded-full transition-all duration-500"
                    style={{ width: `${((AUTO_EVERY - nextThreshold) / AUTO_EVERY) * 100}%` }} />
                </div>
              </div>
            </div>

            <button onClick={handleCapture} disabled={!mpReady || capturing}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-40 disabled:cursor-not-allowed text-navy-950 font-semibold transition-all duration-200 cursor-pointer shadow-lg shadow-teal-900/30">
              <CameraIcon className="w-5 h-5" />
              {capturing ? "Capturing…" : `Capture "${selectedLabel}"`}
            </button>

            <div className={cn(
              "rounded-2xl p-4 border shadow transition-colors",
              retrainState === "running" ? "bg-yellow-900/20 border-yellow-700/40" :
              retrainState === "done"    ? "bg-teal-900/20 border-teal-700/40" :
              retrainState === "failed"  ? "bg-red-900/20 border-red-700/40" :
              "bg-navy-800 border-navy-700/60"
            )}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Model Retrain</p>
                {modelVersion > 0 && <span className="text-[9px] text-slate-600 font-mono">v{modelVersion}</span>}
              </div>
              {retrainState === "running" ? (
                <div className="flex items-center gap-2 text-yellow-300 text-xs">
                  <span className="w-3 h-3 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin shrink-0" />
                  {retrainMsg || "Training…"}
                </div>
              ) : retrainState === "done" ? (
                <p className="text-xs text-teal-300">{retrainMsg}</p>
              ) : retrainState === "failed" ? (
                <p className="text-xs text-red-300">{retrainMsg}</p>
              ) : (
                <p className="text-xs text-slate-400">Auto-triggers every {AUTO_EVERY} contributions. Or retrain now.</p>
              )}
              <button onClick={handleRetrain} disabled={retrainState === "running"}
                className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-navy-700 hover:bg-teal-700/50 disabled:opacity-40 disabled:cursor-not-allowed text-sm transition-colors cursor-pointer border border-navy-600">
                <RetrainIcon className="w-4 h-4" />
                {retrainState === "running" ? "Training…" : "Retrain Now"}
              </button>
            </div>

            <button onClick={handleDelete}
              className="flex items-center justify-center gap-2 py-2 rounded-xl bg-navy-700 hover:bg-red-900/50 text-sm transition-colors cursor-pointer border border-navy-600">
              <XIcon className="w-4 h-4" /> Delete Last Sample
            </button>

            <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 text-xs text-slate-400 space-y-1.5">
              <p className="text-slate-200 font-semibold text-sm mb-1">How it works</p>
              <p>1. Pick a letter, form the handshape, click Capture</p>
              <p>2. Aim for ≥ 15 samples per letter</p>
              <p>3. Every {AUTO_EVERY} samples the model retrains automatically</p>
              <p>4. The browser hot-reloads the new model — no refresh needed</p>
            </div>
          </>
        )}

        {/* ── WORD SIGN MODE ────────────────────────────────────────────────── */}
        {mode === "word" && (
          <>
            <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 shadow-lg">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-3 font-semibold">Select Sign</p>
              <div className="grid grid-cols-3 gap-1.5">
                {WORD_SIGNS.map(({ id, label }) => (
                  <button key={id} onClick={() => setSelectedSign(id)}
                    className={cn(
                      "py-1.5 px-1 text-[11px] rounded-lg transition-all duration-150 cursor-pointer border text-center leading-tight",
                      selectedSign === id
                        ? "bg-teal-500 text-navy-950 font-bold border-teal-400 shadow-lg"
                        : "bg-navy-700 hover:bg-navy-600 text-slate-300 border-navy-600"
                    )}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 shadow">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-300">
                  Samples for <span className="text-teal-400 font-bold">{WORD_SIGNS.find((s) => s.id === selectedSign)?.label}</span>
                </span>
                <span className="text-2xl font-bold text-white font-mono">{wordCounts[selectedSign] ?? 0}</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Aim for ≥ 15 samples per sign</p>
            </div>

            <button onClick={handleWordCapture} disabled={!mpReady || capturing || countdown !== null}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-40 disabled:cursor-not-allowed text-navy-950 font-semibold transition-all duration-200 cursor-pointer shadow-lg shadow-teal-900/30">
              <CameraIcon className="w-5 h-5" />
              {countdown !== null ? `Get ready… ${countdown}` : capturing ? `Recording… ${wordFrameCount}/${WORD_FRAMES}` : "Record Sign"}
            </button>

            <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 shadow">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2 font-semibold">
                All Signs — {Object.values(wordCounts).reduce((a, b) => a + b, 0)} total
              </p>
              <div className="space-y-1">
                {WORD_SIGNS.map(({ id, label }) => {
                  const n = wordCounts[id] ?? 0;
                  return (
                    <div key={id} className="flex items-center gap-2 text-xs">
                      <span className="w-16 text-slate-400 shrink-0 truncate">{label}</span>
                      <div className="flex-1 h-1 bg-navy-700 rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all duration-500", n >= 15 ? "bg-teal-400" : "bg-teal-700/60")}
                          style={{ width: `${Math.min((n / 20) * 100, 100)}%` }} />
                      </div>
                      <span className={cn("w-5 text-right font-mono", n >= 15 ? "text-teal-400" : "text-slate-500")}>{n}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Word-sign retrain card */}
            <div className={cn(
              "rounded-2xl p-4 border shadow transition-colors",
              wordRetrainState === "running" ? "bg-yellow-900/20 border-yellow-700/40" :
              wordRetrainState === "done"    ? "bg-teal-900/20 border-teal-700/40" :
              wordRetrainState === "failed"  ? "bg-red-900/20 border-red-700/40" :
              "bg-navy-800 border-navy-700/60"
            )}>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-2">
                CamSL Word-Sign Model
              </p>
              {wordRetrainState === "running" ? (
                <div className="flex items-center gap-2 text-yellow-300 text-xs">
                  <span className="w-3 h-3 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin shrink-0" />
                  {wordRetrainMsg || "Training…"}
                </div>
              ) : wordRetrainState === "done" ? (
                <p className="text-xs text-teal-300">{wordRetrainMsg}</p>
              ) : wordRetrainState === "failed" ? (
                <p className="text-xs text-red-300">{wordRetrainMsg}</p>
              ) : (
                <p className="text-xs text-slate-400">
                  Auto-trains every {WORD_AUTO_EVERY} contributions (needs ≥ 3 samples in 2+ signs). Or train now.
                </p>
              )}
              <button onClick={handleWordRetrain} disabled={wordRetrainState === "running"}
                className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-navy-700 hover:bg-teal-700/50 disabled:opacity-40 disabled:cursor-not-allowed text-sm transition-colors cursor-pointer border border-navy-600">
                <RetrainIcon className="w-4 h-4" />
                {wordRetrainState === "running" ? "Training…" : "Retrain Now"}
              </button>
            </div>

            <button onClick={handleDeleteWord}
              className="flex items-center justify-center gap-2 py-2 rounded-xl bg-navy-700 hover:bg-red-900/50 text-sm transition-colors cursor-pointer border border-navy-600">
              <XIcon className="w-4 h-4" /> Delete Last Sample
            </button>

            <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 text-xs text-slate-400 space-y-1.5">
              <p className="text-slate-200 font-semibold text-sm mb-1">How it works</p>
              <p>1. Select a sign, position both hands in frame</p>
              <p>2. Click Record — 3-second countdown starts</p>
              <p>3. Perform the sign clearly; 30 frames auto-captured</p>
              <p>4. Contribute ≥ 3 samples in ≥ 2 signs to unlock retraining</p>
              <p>5. Every {WORD_AUTO_EVERY} samples the CamSL model retrains automatically</p>
              <p>6. Once trained, your signs override the ASL baseline model</p>
            </div>
          </>
        )}

        {/* ── VIDEO CLIPS MODE ────────────────────────────────────────────── */}
        {mode === "clips" && (
          <>
            {/* Category + sign */}
            <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 shadow-lg space-y-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Sign to Record</p>

              <div className="flex rounded-lg border border-navy-700/60 overflow-hidden bg-navy-700">
                {(["alphabet", "word_signs"] as const).map((c) => (
                  <button key={c} onClick={() => {
                    setClipCategory(c);
                    setClipSign(c === "alphabet" ? "A" : "hello");
                  }}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                      clipCategory === c ? "bg-teal-500 text-navy-950" : "text-slate-400 hover:text-slate-200"
                    )}>
                    {c === "alphabet" ? "Letter" : "Word Sign"}
                  </button>
                ))}
              </div>

              {clipCategory === "alphabet" ? (
                <div className="grid grid-cols-6 gap-1">
                  {CLIP_ALPHABET.map((l) => (
                    <button key={l} onClick={() => setClipSign(l)}
                      className={cn(
                        "aspect-square flex items-center justify-center text-xs font-mono rounded-lg transition-all cursor-pointer border",
                        clipSign === l
                          ? "bg-teal-500 text-navy-950 font-bold border-teal-400"
                          : "bg-navy-700 hover:bg-navy-600 text-slate-300 border-navy-600"
                      )}>
                      {l}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {CLIP_WORD_SIGNS.map(({ id, label }) => (
                    <button key={id} onClick={() => setClipSign(id)}
                      className={cn(
                        "py-1.5 px-1 text-[11px] rounded-lg transition-all cursor-pointer border text-center leading-tight",
                        clipSign === id
                          ? "bg-teal-500 text-navy-950 font-bold border-teal-400"
                          : "bg-navy-700 hover:bg-navy-600 text-slate-300 border-navy-600"
                      )}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Contributor name */}
            <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 shadow">
              <label className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold block mb-2">
                Contributor Name (optional)
              </label>
              <input
                type="text"
                value={clipContributor}
                onChange={(e) => setClipContributor(e.target.value)}
                placeholder="Your name or leave blank"
                className="w-full bg-navy-700 border border-navy-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-teal-500 transition-colors"
              />
            </div>

            {/* Record button + progress */}
            <div className="space-y-2">
              {/* Countdown overlay handled on video canvas above */}
              {clipCountdown !== null && (
                <div className="flex items-center justify-center py-2">
                  <span className="text-5xl font-black text-teal-400" style={{ textShadow: "0 0 20px #00f3ff" }}>
                    {clipCountdown}
                  </span>
                </div>
              )}

              {clipRecording && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Recording…
                    </span>
                    <span>{clipProgress.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden">
                    <div className="h-full bg-red-500 rounded-full transition-all duration-75"
                      style={{ width: `${clipProgress}%` }} />
                  </div>
                </div>
              )}

              <button
                onClick={handleClipRecord}
                disabled={clipRecording || clipCountdown !== null}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-all duration-200 cursor-pointer shadow-lg">
                <CameraIcon className="w-5 h-5" />
                {clipCountdown !== null
                  ? `Starting in ${clipCountdown}…`
                  : clipRecording
                  ? "Recording…"
                  : `Record "${clipCategory === "alphabet" ? clipSign : CLIP_WORD_SIGNS.find(s=>s.id===clipSign)?.label ?? clipSign}" (4s)`}
              </button>

              {/* Upload status */}
              {clipUploadState !== "idle" && (
                <div className={cn(
                  "rounded-xl p-3 border text-xs flex items-start gap-2",
                  clipUploadState === "uploading" ? "bg-yellow-900/20 border-yellow-700/40 text-yellow-300" :
                  clipUploadState === "success"   ? "bg-teal-900/20  border-teal-700/40  text-teal-300"  :
                                                    "bg-red-900/20   border-red-700/40   text-red-300"
                )}>
                  {clipUploadState === "uploading" && <span className="w-3 h-3 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin shrink-0 mt-0.5" />}
                  {clipUploadMsg}
                </div>
              )}
            </div>

            {/* Clip stats */}
            <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 shadow">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">
                  Community Clips — {clipStatsTotal} total
                </p>
                <button
                  onClick={() => getClipStats().then((r) => { setClipStats(r.counts); setClipStatsTotal(r.total); }).catch(() => {})}
                  className="text-[10px] text-slate-500 hover:text-teal-400 transition-colors cursor-pointer">
                  ↻ refresh
                </button>
              </div>
              {Object.keys(clipStats).length === 0 ? (
                <p className="text-xs text-slate-500">No clips yet — record the first one!</p>
              ) : (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {Object.entries(clipStats).sort(([a],[b])=>a.localeCompare(b)).map(([sign, count]) => (
                    <div key={sign} className="flex items-center gap-2 text-xs">
                      <span className="w-20 text-slate-400 shrink-0 truncate font-mono">{sign}</span>
                      <div className="flex-1 h-1 bg-navy-700 rounded-full overflow-hidden">
                        <div className="h-full bg-teal-500 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min((count / 20) * 100, 100)}%` }} />
                      </div>
                      <span className="w-5 text-right text-teal-400 font-mono">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 text-xs text-slate-400 space-y-1.5">
              <p className="text-slate-200 font-semibold text-sm mb-1">How it works</p>
              <p>1. Select a letter or word sign</p>
              <p>2. Click Record — 3-second countdown, then 4s clip captured</p>
              <p>3. Video is uploaded to the shared Supabase dataset</p>
              <p>4. Clips include both hands visible in frame</p>
            </div>
          </>
        )}

        {/* Status toast */}
        {status && (
          <div className={cn("rounded-xl p-3 border text-xs",
            status.ok ? "bg-teal-900/30 border-teal-800/60 text-teal-300"
                      : "bg-red-900/30 border-red-800/60 text-red-300")}>
            {status.msg}
          </div>
        )}
      </div>
    </div>
  );
}
