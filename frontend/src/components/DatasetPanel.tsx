import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaPipe } from "../hooks/useMediaPipe";
import { normaliseLandmarks } from "../lib/landmarks";
import {
  addContribution, deleteLastContribution, getContributionCounts,
  triggerRetrain, getRetrainStatus,
} from "../lib/api";
import { CameraIcon, XIcon } from "./icons";
import { cn } from "../lib/utils";

const LABELS = "ABCDEFGHIKLMNOPQRSTUVWXY".split("");
const AUTO_EVERY = 25; // must match backend AUTO_RETRAIN_EVERY

function RetrainIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

export function DatasetPanel() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const [selectedLabel, setSelectedLabel] = useState("A");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const captureRef = useRef<Float32Array[]>([]);
  const capturingRef = useRef(false);

  // Retrain state
  const [retrainState, setRetrainState] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [retrainMsg, setRetrainMsg] = useState("");
  const [modelVersion, setModelVersion] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { ready: mpReady, detect } = useMediaPipe();

  useEffect(() => {
    (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false }).catch(() => null);
      if (!stream) return;
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    })();
    getContributionCounts().then((r) => { setCounts(r.counts); setTotal(r.total); }).catch(() => {});
    // Load current model version
    getRetrainStatus().then((r) => setModelVersion(r.version)).catch(() => {});
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      cancelAnimationFrame(rafRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Poll retrain status while running
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
            // Hot-reload: dispatch event so useInference can reload weights
            window.dispatchEvent(new CustomEvent("camsl:model-updated", { detail: { version: r.version } }));
          }
        }
      } catch { /* ignore */ }
    }, 2000);
  }, [modelVersion]);

  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop);
    if (!capturingRef.current || !mpReady) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    const { landmarks } = detect(video);
    if (landmarks) captureRef.current.push(normaliseLandmarks(landmarks));
  }, [mpReady, detect]);

  useEffect(() => { rafRef.current = requestAnimationFrame(loop); return () => cancelAnimationFrame(rafRef.current); }, [loop]);

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

      // Auto-retrain fires on backend; start polling so UI reflects it
      if (r.total % AUTO_EVERY === 0) {
        setRetrainState("running");
        setRetrainMsg("Auto-retraining started…");
        startPolling();
      }
    } catch (e) { setStatus({ msg: "Error: " + String(e), ok: false }); }
  };

  const handleDelete = async () => {
    try {
      await deleteLastContribution();
      const c = await getContributionCounts();
      setCounts(c.counts); setTotal(c.total);
      setStatus({ msg: "Last sample deleted.", ok: true });
    } catch { setStatus({ msg: "Nothing to delete.", ok: false }); }
  };

  const handleRetrain = async () => {
    try {
      await triggerRetrain();
      setRetrainState("running");
      setRetrainMsg("Retraining started…");
      startPolling();
    } catch (e) { setStatus({ msg: "Could not start retrain: " + String(e), ok: false }); }
  };

  const nextThreshold = AUTO_EVERY - (total % AUTO_EVERY || AUTO_EVERY);

  return (
    <div className="flex gap-4 p-4 h-full">
      {/* Webcam */}
      <div className="flex-1 relative rounded-2xl overflow-hidden bg-navy-800 border border-navy-700/60 shadow-xl">
        <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" autoPlay muted playsInline />
        {capturing && (
          <div className="absolute inset-0 border-4 border-teal-400 rounded-2xl animate-pulse pointer-events-none" />
        )}
      </div>

      {/* Controls */}
      <div className="w-72 flex flex-col gap-3 shrink-0 overflow-y-auto">
        {/* Label picker */}
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

        {/* Sample count */}
        <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 shadow">
          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-300">
              Samples for <span className="text-teal-400 font-bold font-mono">{selectedLabel}</span>
            </span>
            <span className="text-2xl font-bold text-white" style={{ fontFamily: "'Fira Code', monospace" }}>
              {counts[selectedLabel] ?? 0}
            </span>
          </div>
          <div className="mt-2">
            <div className="flex justify-between text-[10px] text-slate-500 mb-1">
              <span>Total: {total}</span>
              <span>Next retrain in {nextThreshold} samples</span>
            </div>
            <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-teal-500/60 rounded-full transition-all duration-500"
                style={{ width: `${((AUTO_EVERY - nextThreshold) / AUTO_EVERY) * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* Capture */}
        <button onClick={handleCapture} disabled={!mpReady || capturing}
          className="flex items-center justify-center gap-2 py-3 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-40 disabled:cursor-not-allowed text-navy-950 font-semibold transition-all duration-200 cursor-pointer shadow-lg shadow-teal-900/30">
          <CameraIcon className="w-5 h-5" />
          {capturing ? "Capturing…" : `Capture "${selectedLabel}"`}
        </button>

        {/* Retrain card */}
        <div className={cn(
          "rounded-2xl p-4 border shadow transition-colors",
          retrainState === "running"  ? "bg-yellow-900/20 border-yellow-700/40" :
          retrainState === "done"     ? "bg-teal-900/20 border-teal-700/40" :
          retrainState === "failed"   ? "bg-red-900/20 border-red-700/40" :
          "bg-navy-800 border-navy-700/60"
        )}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Model Retrain</p>
            {modelVersion > 0 && (
              <span className="text-[9px] text-slate-600 font-mono">v{modelVersion}</span>
            )}
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
            <p className="text-xs text-slate-400">
              Auto-triggers every {AUTO_EVERY} contributions. Or retrain now manually.
            </p>
          )}

          <button onClick={handleRetrain} disabled={retrainState === "running"}
            className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-navy-700 hover:bg-teal-700/50 disabled:opacity-40 disabled:cursor-not-allowed text-sm transition-colors cursor-pointer border border-navy-600">
            <RetrainIcon className="w-4 h-4" />
            {retrainState === "running" ? "Training…" : "Retrain Now"}
          </button>
        </div>

        {/* Delete + status */}
        <button onClick={handleDelete}
          className="flex items-center justify-center gap-2 py-2 rounded-xl bg-navy-700 hover:bg-red-900/50 text-sm transition-colors cursor-pointer border border-navy-600">
          <XIcon className="w-4 h-4" /> Delete Last Sample
        </button>

        {status && (
          <div className={cn("rounded-xl p-3 border text-xs",
            status.ok ? "bg-teal-900/30 border-teal-800/60 text-teal-300"
                      : "bg-red-900/30 border-red-800/60 text-red-300")}>
            {status.msg}
          </div>
        )}

        {/* Instructions */}
        <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 text-xs text-slate-400 space-y-1.5">
          <p className="text-slate-200 font-semibold text-sm mb-1">How it works</p>
          <p>1. Pick a letter, form the handshape, click Capture</p>
          <p>2. Aim for ≥ 15 samples per letter</p>
          <p>3. Every {AUTO_EVERY} samples the model retrains automatically</p>
          <p>4. The browser hot-reloads the new model — no refresh needed</p>
        </div>
      </div>
    </div>
  );
}
