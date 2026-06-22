import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaPipe } from "../hooks/useMediaPipe";
import { normaliseLandmarks } from "../lib/landmarks";
import { addContribution, deleteLastContribution, getContributionCounts } from "../lib/api";

const LABELS = "ABCDEFGHIKLMNOPQRSTUVWXY".split("");
const CAPTURE_FRAMES = 5;  // average N frames for a stable sample

export function DatasetPanel() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const [selectedLabel, setSelectedLabel] = useState("A");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [capturing, setCapturing] = useState(false);
  const captureBufferRef = useRef<Float32Array[]>([]);

  const { ready: mpReady, detect } = useMediaPipe();

  useEffect(() => {
    (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
    })().catch(() => {});
    getContributionCounts().then((r) => { setCounts(r.counts); setTotal(r.total); }).catch(() => {});
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); cancelAnimationFrame(rafRef.current); };
  }, []);

  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop);
    if (!capturing) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !mpReady) return;
    const { landmarks } = detect(video);
    if (!landmarks) return;
    captureBufferRef.current.push(normaliseLandmarks(landmarks));
  }, [mpReady, detect, capturing]);

  useEffect(() => { rafRef.current = requestAnimationFrame(loop); return () => cancelAnimationFrame(rafRef.current); }, [loop]);

  const handleCapture = async () => {
    captureBufferRef.current = [];
    setCapturing(true);
    setStatus("Hold your hand still…");
    await new Promise((r) => setTimeout(r, (CAPTURE_FRAMES / 30) * 1000 + 300));
    setCapturing(false);
    const frames = captureBufferRef.current;
    if (frames.length < 1) { setStatus("No hand detected — try again"); return; }
    // Average across captured frames
    const avg = new Float32Array(63);
    for (const f of frames) f.forEach((v, i) => (avg[i] += v));
    avg.forEach((_, i) => (avg[i] /= frames.length));
    try {
      await addContribution(selectedLabel, Array.from(avg));
      const r = await getContributionCounts();
      setCounts(r.counts); setTotal(r.total);
      setStatus(`✓ Saved sample for ${selectedLabel} (total: ${r.counts[selectedLabel] ?? 1})`);
    } catch (e) { setStatus("Error saving: " + String(e)); }
  };

  const handleDelete = async () => {
    try {
      const r = await deleteLastContribution();
      const c = await getContributionCounts();
      setCounts(c.counts); setTotal(c.total);
      setStatus(`Deleted last sample. ${r.remaining} remaining.`);
    } catch { setStatus("Nothing to delete."); }
  };

  return (
    <div className="flex gap-4 p-4 h-full">
      {/* Webcam */}
      <div className="flex-1 rounded-xl overflow-hidden bg-navy-800 aspect-video">
        <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" muted playsInline />
      </div>

      {/* Controls */}
      <div className="w-72 flex flex-col gap-3">
        <div className="bg-navy-800 rounded-xl p-4 border border-navy-700">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Select Label</p>
          <div className="grid grid-cols-6 gap-1">
            {LABELS.map((l) => (
              <button
                key={l}
                onClick={() => setSelectedLabel(l)}
                className={`aspect-square flex items-center justify-center text-xs font-mono rounded transition-colors ${
                  selectedLabel === l ? "bg-teal-500 text-navy-950 font-bold" : "bg-navy-700 hover:bg-navy-600"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-navy-800 rounded-xl p-4 border border-navy-700">
          <div className="flex justify-between text-sm text-slate-300 mb-1">
            <span>Samples for <strong className="text-teal-400">{selectedLabel}</strong></span>
            <span>{counts[selectedLabel] ?? 0}</span>
          </div>
          <div className="text-xs text-slate-500">Total contributions: {total}</div>
        </div>

        <button
          onClick={handleCapture}
          disabled={!mpReady || capturing}
          className="py-3 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-40 text-navy-950 font-semibold transition-colors"
        >
          {capturing ? "Capturing…" : `📸 Capture "${selectedLabel}"`}
        </button>

        <button
          onClick={handleDelete}
          className="py-2 rounded-xl bg-navy-700 hover:bg-red-900 text-sm transition-colors"
        >
          ↩ Delete Last Sample
        </button>

        {status && (
          <div className="bg-navy-800 rounded-xl p-3 border border-navy-700 text-xs text-slate-300">
            {status}
          </div>
        )}

        <div className="bg-navy-800 rounded-xl p-3 border border-navy-700 text-xs text-slate-400 space-y-1">
          <p className="text-slate-300 font-semibold">How to contribute</p>
          <p>1. Select the letter you want to contribute</p>
          <p>2. Form the correct handshape and hold still</p>
          <p>3. Click Capture — aim for ≥15 samples per letter</p>
          <p>Contributions improve the CamSL model over time.</p>
        </div>
      </div>
    </div>
  );
}
