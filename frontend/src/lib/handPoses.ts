/**
 * handPoses.ts — forward-kinematics pose engine for the 3D hand model.
 *
 * Coordinate system:
 *   Wrist at origin. Fingers point in +Y when straight.
 *   Palm faces +Z. Curling fingers rotates them toward +Z (toward viewer).
 *   +X is to the right of the hand.
 *
 * MediaPipe landmark order:
 *   0=wrist
 *   1-4  = thumb  (CMC, MCP, IP, TIP)
 *   5-8  = index  (MCP, PIP, DIP, TIP)
 *   9-12 = middle (MCP, PIP, DIP, TIP)
 *   13-16= ring   (MCP, PIP, DIP, TIP)
 *   17-20= pinky  (MCP, PIP, DIP, TIP)
 */

type V3 = [number, number, number];

function rotV(v: V3, ax: V3, deg: number): V3 {
  const a = deg * (Math.PI / 180);
  const c = Math.cos(a), s = Math.sin(a);
  const [x, y, z] = v, [ax0, ay, az] = ax;
  const dot = ax0 * x + ay * y + az * z;
  return [
    x * c + (ay * z - az * y) * s + ax0 * dot * (1 - c),
    y * c + (az * x - ax0 * z) * s + ay * dot * (1 - c),
    z * c + (ax0 * y - ay * x) * s + az * dot * (1 - c),
  ];
}
const add = (a: V3, b: V3): V3 => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const scale = (v: V3, s: number): V3 => [v[0]*s, v[1]*s, v[2]*s];

/** Compute 4 positions for a finger chain using FK. Returns [start, j1, j2, tip]. */
function chain(start: V3, up: V3, bendAxis: V3, spread: number, lens: V3, bends: V3): V3[] {
  const up2 = rotV(up, [0, 1, 0], spread);
  const pts: V3[] = [start];
  let pos = start, cumBend = 0;
  for (let i = 0; i < 3; i++) {
    cumBend += bends[i];
    const dir = rotV(up2, bendAxis, cumBend);
    const next = add(pos, scale(dir, lens[i]));
    pts.push(next); pos = next;
  }
  return pts;
}

// ── Anatomy ────────────────────────────────────────────────────────────────────
const BEND: V3 = [1, 0, 0];          // curl axis: rotates +Y toward +Z
const UP: V3 = [0, 1, 0];
const THUMB_CMC: V3 = [-0.22, 0.12, 0.04];
const THUMB_UP: V3 = [-0.38, 0.92, 0.10]; // thumb natural direction
const THUMB_BEND: V3 = [0, 0.2, -1];      // thumb curl axis (toward index)

const LENS = {
  thumb:  [0.10, 0.09, 0.07] as V3,
  index:  [0.14, 0.10, 0.08] as V3,
  middle: [0.16, 0.11, 0.09] as V3,
  ring:   [0.14, 0.10, 0.08] as V3,
  pinky:  [0.11, 0.08, 0.06] as V3,
};
const MCP = {
  index:  [-0.10, 0.38, 0.00] as V3,
  middle: [ 0.00, 0.40, 0.00] as V3,
  ring:   [ 0.10, 0.38, 0.00] as V3,
  pinky:  [ 0.19, 0.33, 0.00] as V3,
};

interface FingerPose { mcp: number; pip: number; dip: number; spread: number }
interface ThumbPose  { cmc: number; mcp: number; ip: number; spread: number }
interface Pose {
  index: FingerPose; middle: FingerPose;
  ring: FingerPose;  pinky: FingerPose;
  thumb: ThumbPose;
}

// Shorthand helpers
const f = (mcp: number, pip: number, dip: number, spread = 0): FingerPose =>
  ({ mcp, pip, dip, spread });
const t = (cmc: number, mcp: number, ip: number, spread = 0): ThumbPose =>
  ({ cmc, mcp, ip, spread });

// Reusable presets
const FIST   = f(70, 90, 75);
const STRT   = f(0, 0, 0);
const HALF   = f(40, 35, 20);
const TIGHT  = f(80, 100, 80);
const TUCKED = t(0, 85, 20, 15);   // thumb tucked across palm
const SIDE   = t(0, 0, 0, -30);    // thumb sticking out sideways
const ALONG  = t(0, 45, 15, -18);  // thumb alongside fist

// ── Letter poses ───────────────────────────────────────────────────────────────
const POSES: Record<string, Pose> = {
  A: { index: FIST, middle: FIST, ring: FIST, pinky: FIST,
       thumb: ALONG },
  B: { index: STRT, middle: STRT, ring: STRT, pinky: STRT,
       thumb: TUCKED },
  C: { index: HALF, middle: HALF, ring: HALF, pinky: f(35,28,15),
       thumb: t(0, 40, 20, -15) },
  D: { index: STRT, middle: FIST, ring: FIST, pinky: FIST,
       thumb: t(0, 55, 20, 12) },
  E: { index: TIGHT, middle: TIGHT, ring: TIGHT, pinky: f(75,95,75),
       thumb: t(0, 30, 30, 20) },
  F: { index: f(65,52,0), middle: STRT, ring: STRT, pinky: STRT,
       thumb: t(0, 42, 22, 8) },
  G: { index: f(0,0,0,-38), middle: FIST, ring: FIST, pinky: FIST,
       thumb: t(0,0,0,-22) },
  H: { index: f(0,0,0,-28), middle: f(0,0,0,-18), ring: FIST, pinky: FIST,
       thumb: TUCKED },
  I: { index: FIST, middle: FIST, ring: FIST, pinky: f(0,0,0,14),
       thumb: t(0,40,15,15) },
  K: { index: STRT, middle: f(0,45,0,6), ring: FIST, pinky: FIST,
       thumb: t(0,0,0,5) },
  L: { index: STRT, middle: FIST, ring: FIST, pinky: FIST,
       thumb: SIDE },
  M: { index: f(68,72,60,-4), middle: f(68,72,60,0), ring: f(68,72,60,5), pinky: FIST,
       thumb: t(0,60,30,12) },
  N: { index: f(68,72,60,-4), middle: f(68,72,60,2), ring: FIST, pinky: FIST,
       thumb: t(0,60,30,12) },
  O: { index: f(52,55,32), middle: f(52,55,32), ring: f(50,50,28), pinky: f(45,45,22),
       thumb: t(0,45,25,-10) },
  P: { index: STRT, middle: f(0,45,0,10), ring: FIST, pinky: FIST,
       thumb: t(0,0,0,5) },
  Q: { index: f(0,0,0,0), middle: FIST, ring: FIST, pinky: FIST,
       thumb: t(0,0,0,-20) },
  R: { index: f(0,0,0,-8), middle: f(0,0,0,-14), ring: FIST, pinky: FIST,
       thumb: TUCKED },
  S: { index: FIST, middle: FIST, ring: FIST, pinky: FIST,
       thumb: t(0, 32, 22, 10) },
  T: { index: FIST, middle: FIST, ring: FIST, pinky: FIST,
       thumb: t(0, 0, 0, 0) },
  U: { index: f(0,0,0,-4), middle: f(0,0,0,4), ring: FIST, pinky: FIST,
       thumb: TUCKED },
  V: { index: f(0,0,0,-12), middle: f(0,0,0,12), ring: FIST, pinky: FIST,
       thumb: TUCKED },
  W: { index: f(0,0,0,-10), middle: f(0,0,0,0), ring: f(0,0,0,10), pinky: FIST,
       thumb: TUCKED },
  X: { index: f(0,62,48), middle: FIST, ring: FIST, pinky: FIST,
       thumb: t(0,42,15,10) },
  Y: { index: FIST, middle: FIST, ring: FIST, pinky: f(0,0,0,14),
       thumb: SIDE },
};

// ── Public API ─────────────────────────────────────────────────────────────────
export const HAND_CONNECTIONS: [number, number][] = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17],
];

// Scale applied to all landmark positions so the hand is large in the scene.
// Camera in Hand3D.tsx is set for this scale.
const HAND_SCALE = 3;

/** Returns 63 floats: 21 (x,y,z) positions for the hand landmarks. */
export function getLandmarks(letter: string): number[] {
  const pose = POSES[letter.toUpperCase()] ?? POSES['A'];

  const thumb  = chain(THUMB_CMC, THUMB_UP, THUMB_BEND, pose.thumb.spread,
                       LENS.thumb, [pose.thumb.cmc, pose.thumb.mcp, pose.thumb.ip]);
  const index  = chain(MCP.index,  UP, BEND, pose.index.spread,
                       LENS.index,  [pose.index.mcp,  pose.index.pip,  pose.index.dip]);
  const middle = chain(MCP.middle, UP, BEND, pose.middle.spread,
                       LENS.middle, [pose.middle.mcp, pose.middle.pip, pose.middle.dip]);
  const ring   = chain(MCP.ring,   UP, BEND, pose.ring.spread,
                       LENS.ring,   [pose.ring.mcp,   pose.ring.pip,   pose.ring.dip]);
  const pinky  = chain(MCP.pinky,  UP, BEND, pose.pinky.spread,
                       LENS.pinky,  [pose.pinky.mcp,  pose.pinky.pip,  pose.pinky.dip]);

  // Assemble in MediaPipe landmark order, scaled up
  const lms: V3[] = [
    [0, 0, 0],
    THUMB_CMC, thumb[1], thumb[2], thumb[3],
    index[0],  index[1],  index[2],  index[3],
    middle[0], middle[1], middle[2], middle[3],
    ring[0],   ring[1],   ring[2],   ring[3],
    pinky[0],  pinky[1],  pinky[2],  pinky[3],
  ];

  return lms.flat().map(v => v * HAND_SCALE);
}
