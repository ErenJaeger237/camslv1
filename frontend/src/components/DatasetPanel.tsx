import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaPipe } from "../hooks/useMediaPipe";
import { normaliseLandmarks } from "../lib/landmarks";
import { addContribution, deleteLastContribution, getContributionCounts } from "../lib/api";
import { CameraIcon, XIcon } from "./icons";
import { cn } from "../lib/utils";

const LABELS = "ABCDEFGHIKLMNOPQRSTUVWXY".split("");

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

  const { ready: mpReady, detect } = useMediaPipe();

  useEffect(() => {
    (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false }).catch(() => null);
      if (!stream) return;
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    })();
    getContributionCounts().then((r) => { setCounts(r.counts); setTotal(r.total); }).catch(() => {});
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); cancelAnimationFrame(rafRef.current); };
  }, []);

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
      setStatus({ msg: `Saved sample for ${selectedLabel} — total: ${r.counts[selectedLabel] ?? 1}`, ok: true });
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
      <div className="w-72 flex flex-col gap-3 shrink-0">
        {/* Label picker */}
        <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 shadow-lg">
          <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-3 font-semibold">Select Label</p>
          <div className="grid grid-cols-6 gap-1">
            {LABELS.map((l) => (
              <button
                key={l}
                onClick={() => setSelectedLabel(l)}
                className={cn(
                  "aspect-square flex items-center justify-center text-xs font-mono rounded-lg transition-all duration-150 cursor-pointer border",
                  selectedLabel === l
                    ? "bg-teal-500 text-navy-950 font-bold border-teal-400 shadow-lg"
                    : "bg-navy-700 hover:bg-navy-600 text-slate-300 border-navy-600"
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* Count */}
        <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 shadow">
          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-300">
              Samples for <span className="text-teal-400 font-bold font-mono">{selectedLabel}</span>
            </span>
            <span className="text-2xl font-bold text-white" style={{ fontFamily: "'Fira Code', monospace" }}>
              {counts[selectedLabel] ?? 0}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">Total: {total} samples</p>
        </div>

        {/* Capture */}
        <button
          onClick={handleCapture}
          disabled={!mpReady || capturing}
          className="flex items-center justify-center gap-2 py-3 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-40 disabled:cursor-not-allowed text-navy-950 font-semibold transition-all duration-200 cursor-pointer shadow-lg shadow-teal-900/30"
        >
          <CameraIcon className="w-5 h-5" />
          {capturing ? "Capturing…" : `Capture "${selectedLabel}"`}
        </button>

        {/* Delete */}
        <button
          onClick={handleDelete}
          className="flex items-center justify-center gap-2 py-2 rounded-xl bg-navy-700 hover:bg-red-900/50 text-sm transition-colors cursor-pointer border border-navy-600"
        >
          <XIcon className="w-4 h-4" /> Delete Last Sample
        </button>

        {/* Status */}
        {status && (
          <div className={cn(
            "rounded-xl p-3 border text-xs",
            status.ok
              ? "bg-teal-900/30 border-teal-800/60 text-teal-300"
              : "bg-red-900/30 border-red-800/60 text-red-300"
          )}>
            {status.msg}
          </div>
        )}

        {/* Instructions */}
        <div className="bg-navy-800 rounded-2xl p-4 border border-navy-700/60 text-xs text-slate-400 space-y-1.5">
          <p className="text-slate-200 font-semibold text-sm mb-1">How to contribute</p>
          <p>1. Select the letter you want to contribute</p>
          <p>2. Form the correct handshape and hold still</p>
          <p>3. Click Capture — aim for ≥15 samples per letter</p>
        </div>
      </div>
    </div>
  );
}
