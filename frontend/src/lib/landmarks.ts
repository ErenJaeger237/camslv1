/**
 * landmarks.ts — landmark normalisation, ported from src/landmarks.py.
 *
 * Normalise 21 MediaPipe hand landmarks into 63 translation- and
 * scale-invariant features:
 *   1. Translate so wrist (landmark 0) is the origin.
 *   2. Scale by the wrist→MCP-of-middle-finger distance (landmark 9).
 *
 * Same convention as the Python training pipeline — must stay in sync
 * or inference accuracy drops.
 */

export type RawLandmark = { x: number; y: number; z: number };

export function normaliseLandmarks(landmarks: RawLandmark[]): Float32Array {
  if (landmarks.length !== 21) {
    return new Float32Array(63);
  }

  const wx = landmarks[0].x;
  const wy = landmarks[0].y;
  const wz = landmarks[0].z;

  // Translate to wrist origin
  const translated = landmarks.map((lm) => [lm.x - wx, lm.y - wy, lm.z - wz]);

  // Scale by wrist-to-landmark-9 distance
  const [dx, dy, dz] = translated[9];
  const scale = Math.sqrt(dx * dx + dy * dy + dz * dz);

  const out = new Float32Array(63);
  if (scale > 1e-6) {
    for (let i = 0; i < 21; i++) {
      out[i * 3 + 0] = translated[i][0] / scale;
      out[i * 3 + 1] = translated[i][1] / scale;
      out[i * 3 + 2] = translated[i][2] / scale;
    }
  }
  return out;
}

/**
 * Holistic feature vector: hand(63) + face(60) + pose(27) = 150 features.
 * Face and pose landmarks are optional — zeros if not detected.
 */
export const FACE_KEY_LMS = [33, 133, 362, 263, 61, 291, 17, 0, 4, 152, 70, 105, 107, 336, 334, 300, 159, 145, 386, 374];
export const POSE_KEY_LMS = [11, 12, 13, 14, 15, 16, 23, 24, 0];

export function buildHolisticFeatures(
  handLms: RawLandmark[],
  faceLms: RawLandmark[] | null,
  poseLms: RawLandmark[] | null,
): Float32Array {
  const features = new Float32Array(150);

  // Hand: 63 features (indices 0-62)
  const hand = normaliseLandmarks(handLms);
  features.set(hand, 0);

  // Face: 60 features (indices 63-122), centred on nose tip (landmark 4)
  if (faceLms && faceLms.length > 400) {
    const nose = faceLms[4];
    let offset = 63;
    for (const idx of FACE_KEY_LMS) {
      const lm = faceLms[idx];
      if (lm) {
        features[offset++] = lm.x - nose.x;
        features[offset++] = lm.y - nose.y;
        features[offset++] = lm.z - nose.z;
      } else {
        offset += 3;
      }
    }
  }

  // Pose: 27 features (indices 123-149), centred on shoulder midpoint
  if (poseLms && poseLms.length > 24) {
    const ls = poseLms[11];
    const rs = poseLms[12];
    const cx = ls && rs ? (ls.x + rs.x) / 2 : 0;
    const cy = ls && rs ? (ls.y + rs.y) / 2 : 0;
    const cz = ls && rs ? (ls.z + rs.z) / 2 : 0;
    let offset = 123;
    for (const idx of POSE_KEY_LMS) {
      const lm = poseLms[idx];
      if (lm) {
        features[offset++] = lm.x - cx;
        features[offset++] = lm.y - cy;
        features[offset++] = lm.z - cz;
      } else {
        offset += 3;
      }
    }
  }

  return features;
}
