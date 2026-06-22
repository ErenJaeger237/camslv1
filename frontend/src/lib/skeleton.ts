/**
 * skeleton.ts — draws MediaPipe hand landmarks on a canvas overlay.
 *
 * The video element is CSS-mirrored (scale-x-[-1]), so we mirror the
 * x coordinate too: draw at (1 - lm.x) * w instead of lm.x * w.
 */

type Point = { x: number; y: number };

const CONNECTIONS: [number, number][] = [
  // Thumb
  [0,1],[1,2],[2,3],[3,4],
  // Index
  [0,5],[5,6],[6,7],[7,8],
  // Middle
  [0,9],[9,10],[10,11],[11,12],
  // Ring
  [0,13],[13,14],[14,15],[15,16],
  // Pinky
  [0,17],[17,18],[18,19],[19,20],
  // Palm
  [5,9],[9,13],[13,17],[0,17],
];

export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Point[],
  w: number,
  h: number,
) {
  ctx.clearRect(0, 0, w, h);

  const px = (lm: Point) => ({ x: (1 - lm.x) * w, y: lm.y * h });

  // Connections
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#3ddbd9";
  ctx.shadowColor = "#3ddbd9";
  ctx.shadowBlur = 6;
  ctx.lineCap = "round";

  for (const [a, b] of CONNECTIONS) {
    const pa = px(landmarks[a]);
    const pb = px(landmarks[b]);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  // Fingertip highlights (indices 4, 8, 12, 16, 20)
  const tips = [4, 8, 12, 16, 20];

  // All joints
  ctx.shadowBlur = 0;
  for (let i = 0; i < landmarks.length; i++) {
    const p = px(landmarks[i]);
    const isTip = tips.includes(i);
    ctx.beginPath();
    ctx.arc(p.x, p.y, isTip ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = isTip ? "#3ddbd9" : "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#0d1b2a";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

export function clearCanvas(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
}
