/**
 * holisticLandmarks.ts — Build 150-feature holistic vectors from MediaPipe results.
 *
 * Mirrors landmarks.py (HolisticExtractor) exactly so the signs.keras model
 * receives the same feature distribution it was trained on.
 *
 * Layout: [0:63] hand  [63:123] face (20 key pts)  [123:150] pose (9 key pts)
 */

// MediaPipe 478-point face mesh — same indices as landmarks.py FACE_KEY_LMS
const FACE_KEY_LMS = [55, 107, 46, 285, 336, 276, 159, 145, 386, 374, 61, 291, 13, 14, 10, 152, 234, 454, 4, 1];
const FACE_NOSE_LOCAL = FACE_KEY_LMS.indexOf(4); // = 18, nose tip

// MediaPipe 33-point pose skeleton — same as landmarks.py POSE_KEY_LMS
const POSE_KEY_LMS = [0, 11, 12, 13, 14, 15, 16, 23, 24];

export const NUM_HOLISTIC = 150;

type Pt = { x: number; y: number; z: number };

function normaliseHand(lms: Pt[]): Float32Array {
  const out = new Float32Array(63);
  const wx = lms[0].x, wy = lms[0].y, wz = lms[0].z;
  for (let i = 0; i < 21; i++) {
    out[i * 3]     = lms[i].x - wx;
    out[i * 3 + 1] = lms[i].y - wy;
    out[i * 3 + 2] = lms[i].z - wz;
  }
  // Scale by wrist-to-middle-MCP (landmark 9) distance
  const dx = out[27], dy = out[28], dz = out[29];
  const scale = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (scale > 0) for (let i = 0; i < 63; i++) out[i] /= scale;
  return out;
}

function normaliseFace(lms: Pt[]): Float32Array {
  const out = new Float32Array(60); // 20 × 3
  const sel = FACE_KEY_LMS.map((i) => lms[i]);
  const nose = sel[FACE_NOSE_LOCAL];
  for (let i = 0; i < 20; i++) {
    out[i * 3]     = sel[i].x - nose.x;
    out[i * 3 + 1] = sel[i].y - nose.y;
    out[i * 3 + 2] = sel[i].z - nose.z;
  }
  return out;
}

function normalisePose(lms: Pt[]): Float32Array {
  const out = new Float32Array(27); // 9 × 3
  const sel = POSE_KEY_LMS.map((i) => lms[i]);
  // Centre on shoulder midpoint (local indices 1 and 2 = landmarks 11, 12)
  const smx = (sel[1].x + sel[2].x) / 2;
  const smy = (sel[1].y + sel[2].y) / 2;
  const smz = (sel[1].z + sel[2].z) / 2;
  for (let i = 0; i < 9; i++) {
    out[i * 3]     = sel[i].x - smx;
    out[i * 3 + 1] = sel[i].y - smy;
    out[i * 3 + 2] = sel[i].z - smz;
  }
  return out;
}

/**
 * Combines hand + face + pose landmarks into a single 150-float vector.
 * Returns null if there is no hand (hand is required; face/pose are optional).
 */
export function buildHolisticFeatures(
  handLms: Pt[] | null | undefined,
  faceLms: Pt[] | null | undefined,
  poseLms: Pt[] | null | undefined,
): Float32Array | null {
  if (!handLms || handLms.length < 21) return null;
  const hand = normaliseHand(handLms);
  const face = faceLms && faceLms.length > 454 ? normaliseFace(faceLms) : new Float32Array(60);
  const pose = poseLms && poseLms.length > 24  ? normalisePose(poseLms) : new Float32Array(27);
  const out = new Float32Array(NUM_HOLISTIC);
  out.set(hand, 0);
  out.set(face, 63);
  out.set(pose, 123);
  return out;
}
