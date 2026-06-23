/**
 * skeleton.ts — draws MediaPipe hand landmarks on a canvas overlay.
 *
 * The canvas must be sized to the CONTAINER (clientWidth/clientHeight),
 * not the video's native resolution. We compute the object-cover transform
 * so landmarks map to exactly where they appear in the rendered video.
 *
 * The video is CSS-mirrored (scale-x-[-1]), so we mirror x: (1 - lm.x).
 */

type Point = { x: number; y: number };

const CONNECTIONS: [number, number][] = [
  [0,1],[1,2],[2,3],[3,4],       // Thumb
  [0,5],[5,6],[6,7],[7,8],       // Index
  [0,9],[9,10],[10,11],[11,12],  // Middle
  [0,13],[13,14],[14,15],[15,16],// Ring
  [0,17],[17,18],[18,19],[19,20],// Pinky
  [5,9],[9,13],[13,17],[0,17],   // Palm
];

const TIPS = new Set([4, 8, 12, 16, 20]);

/**
 * @param containerW  canvas.clientWidth  — displayed container pixels
 * @param containerH  canvas.clientHeight
 * @param videoW      video.videoWidth    — native camera resolution
 * @param videoH      video.videoHeight
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Point[],
  containerW: number,
  containerH: number,
  videoW: number,
  videoH: number,
) {
  ctx.clearRect(0, 0, containerW, containerH);

  // ── object-cover maths ──────────────────────────────────────────────────
  // The video is scaled so it covers the container (same as CSS object-cover)
  const scale = Math.max(containerW / videoW, containerH / videoH);
  const renderedW = videoW * scale;
  const renderedH = videoH * scale;
  // Centered crop
  const offsetX = (containerW - renderedW) / 2;
  const offsetY = (containerH - renderedH) / 2;

  // Map a landmark (0-1) → canvas pixel, mirroring x to match CSS flip
  const px = (lm: Point) => ({
    x: (1 - lm.x) * renderedW + offsetX,
    y: lm.y * renderedH + offsetY,
  });

  // ── Draw connections ────────────────────────────────────────────────────
  ctx.save();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#3ddbd9";
  ctx.shadowColor = "#3ddbd9";
  ctx.shadowBlur = 5;
  ctx.lineCap = "round";

  for (const [a, b] of CONNECTIONS) {
    const pa = px(landmarks[a]);
    const pb = px(landmarks[b]);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  // ── Draw joints ─────────────────────────────────────────────────────────
  ctx.shadowBlur = 0;
  for (let i = 0; i < landmarks.length; i++) {
    const p = px(landmarks[i]);
    const tip = TIPS.has(i);
    ctx.beginPath();
    ctx.arc(p.x, p.y, tip ? 6 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = tip ? "#3ddbd9" : "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#0d1b2a";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  ctx.restore();
}

export function clearCanvas(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
}
