/**
 * Hand3D.tsx — holographic 3D hand model.
 *
 * Architecture (the correct hologram pipeline):
 *
 *   EdgesGeometry(CylinderGeometry) per bone  ← gives each bone a 3D tube
 *   EdgesGeometry(SphereGeometry)   per joint ← gives each joint a 3D sphere
 *   LineSegments + LineBasicMaterial(AdditiveBlending) on all of the above
 *   → EffectComposer → UnrealBloomPass → OutputPass
 *
 * Why EdgesGeometry instead of Line segments between joints:
 *   A raw line from point A to point B looks like a stick.
 *   EdgesGeometry(CylinderGeometry) renders the structural EDGES of a 3D tube —
 *   vertical stripes + circular cross-section rings — so as the hand rotates the
 *   lines converge/diverge in perspective exactly like a solid 3D object would,
 *   creating real depth cues.  That is what makes it read as a hologram and not
 *   a 2D plot.
 *
 * Why bloom threshold matters:
 *   The lines are 1 px wide on-screen.  The UnrealBloomPass isolates every pixel
 *   above the threshold and bleeds light outward in a gaussian cascade AFTER the
 *   scene is rendered.  The source lines stay perfectly crisp; the glow is
 *   additive around them.  This is the opposite of a blur filter applied to
 *   the coordinates directly.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer }  from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass }      from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass }      from "three/examples/jsm/postprocessing/OutputPass.js";
import { getLandmarks, HAND_CONNECTIONS } from "../lib/handPoses";

// ── Scene constants ────────────────────────────────────────────────────────────
const CYAN      = 0x00f3ff;
const BG        = 0x020b18;   // dark navy — bloom needs an opaque dark bg
const JOINT_R   = 0.030;      // sphere radius for knuckle joints
const TIP_R     = 0.038;      // fingertip joints slightly larger
const BONE_R    = 0.018;      // cylinder radius for each bone
const TIP_IDS   = new Set([4, 8, 12, 16, 20]);
const LERP_MS   = 450;

// Reusable vectors — avoid allocations inside the hot RAF loop
const _pa  = new THREE.Vector3();
const _pb  = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up  = new THREE.Vector3(0, 1, 0);

// Pre-built edge geometries shared across all joints/bones of the same size
const JOINT_EDGE_GEO = new THREE.EdgesGeometry(new THREE.SphereGeometry(1, 10, 7));
const TIP_EDGE_GEO   = new THREE.EdgesGeometry(new THREE.SphereGeometry(1, 10, 7));
const BONE_EDGE_GEO  = new THREE.EdgesGeometry(
  new THREE.CylinderGeometry(1, 1, 1, 8),
);

function lerp(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => v + (b[i] - v) * t);
}

function updateMeshes(
  lms: number[],
  joints: THREE.LineSegments[],
  bones:  THREE.LineSegments[],
): void {
  // Move each joint sphere to its landmark position
  for (let i = 0; i < 21; i++) {
    joints[i].position.set(lms[i * 3], lms[i * 3 + 1], lms[i * 3 + 2]);
  }

  // Orient each bone cylinder between its two landmark endpoints
  for (let bi = 0; bi < HAND_CONNECTIONS.length; bi++) {
    const [a, b] = HAND_CONNECTIONS[bi];
    _pa.set(lms[a*3], lms[a*3+1], lms[a*3+2]);
    _pb.set(lms[b*3], lms[b*3+1], lms[b*3+2]);
    _dir.subVectors(_pb, _pa).normalize();
    _mid.addVectors(_pa, _pb).multiplyScalar(0.5);

    const len = _pa.distanceTo(_pb);
    bones[bi].position.copy(_mid);
    // Cylinder base is unit-length; scale y to actual bone length, x/z to bone radius
    bones[bi].scale.set(BONE_R, len, BONE_R);
    bones[bi].quaternion.setFromUnitVectors(_up, _dir);
  }
}

export function Hand3D({ letter }: { letter: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rafRef   = useRef<number>(0);

  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    composer: EffectComposer;
    camera:   THREE.PerspectiveCamera;
    group:    THREE.Group;
    joints:   THREE.LineSegments[];
    bones:    THREE.LineSegments[];
    rings:    THREE.LineLoop[];
    currentLms: number[];
    targetLms:  number[];
    lerpStart:  number;
    lerpFrom:   number[];
  } | null>(null);

  // ── Build scene once ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const w = el.clientWidth  || 300;
    const h = el.clientHeight || 300;

    // Renderer — opaque dark bg required for bloom to bleed correctly
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(BG, 1);
    renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    el.appendChild(renderer.domElement);

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, w / h, 0.01, 30);
    camera.position.set(0.4, 1.2, 2.8);
    camera.lookAt(0, 0.9, 0);

    // Single shared wire material — AdditiveBlending means overlapping
    // edges add their brightness together, naturally brightening dense areas.
    const wireMat = new THREE.LineBasicMaterial({
      color:      CYAN,
      transparent: true,
      opacity:    0.90,
      blending:   THREE.AdditiveBlending,
      depthWrite: false,
    });

    // Hand group
    const group = new THREE.Group();
    group.position.set(0, -0.3, 0);
    scene.add(group);

    // ── Joints — EdgesGeometry(Sphere) ─────────────────────────────────────
    // Each joint is a unit-sphere edge mesh scaled to JOINT_R or TIP_R.
    // When the hand rotates, the latitude/longitude edge lines converge in
    // perspective exactly as a real sphere would — this is the 3D depth cue.
    const joints: THREE.LineSegments[] = [];
    for (let i = 0; i < 21; i++) {
      const r    = TIP_IDS.has(i) ? TIP_R : JOINT_R;
      const mesh = new THREE.LineSegments(
        TIP_IDS.has(i) ? TIP_EDGE_GEO : JOINT_EDGE_GEO,
        wireMat,
      );
      mesh.scale.setScalar(r);
      group.add(mesh);
      joints.push(mesh);
    }

    // ── Bones — EdgesGeometry(Cylinder) ────────────────────────────────────
    // Each bone is a unit cylinder edge mesh.  scale.set(BONE_R, length, BONE_R)
    // stretches it to the correct size; quaternion aligns it between two joints.
    // The 8 vertical stripes of the cylinder + 2 ring caps give each bone real
    // 3D volume that perspectively foreshortens as the hand rotates.
    const bones: THREE.LineSegments[] = [];
    for (let i = 0; i < HAND_CONNECTIONS.length; i++) {
      const mesh = new THREE.LineSegments(BONE_EDGE_GEO, wireMat);
      group.add(mesh);
      bones.push(mesh);
    }

    // ── Projector rings at wrist level ─────────────────────────────────────
    // Two concentric LineLoop circles suggest the hologram projector base.
    const ringMat = new THREE.LineBasicMaterial({
      color:      CYAN,
      transparent: true,
      opacity:    0.30,
      blending:   THREE.AdditiveBlending,
      depthWrite: false,
    });
    const rings: THREE.LineLoop[] = [];
    for (const r of [0.28, 0.40]) {
      const loop = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          Array.from({ length: 64 }, (_, i) => {
            const a = (i / 64) * Math.PI * 2;
            return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
          }),
        ),
        ringMat,
      );
      loop.position.y = 0.04;
      group.add(loop);
      rings.push(loop);
    }

    // ── Post-processing ─────────────────────────────────────────────────────
    // RenderPass renders the scene normally into an off-screen buffer.
    // UnrealBloomPass isolates bright pixels and spreads them with a
    // multi-pass gaussian — the source lines remain crisp; the glow bleeds.
    // OutputPass converts the HDR buffer to sRGB for display.
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      1.6,   // strength  — how intense the glow is
      0.45,  // radius    — how far the glow spreads
      0.12,  // threshold — only pixels brighter than this bloom
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // ── Initial pose ────────────────────────────────────────────────────────
    const initLms = getLandmarks(letter || "A");
    updateMeshes(initLms, joints, bones);

    stateRef.current = {
      renderer, composer, camera, group, joints, bones, rings,
      currentLms: [...initLms],
      targetLms:  [...initLms],
      lerpStart:  performance.now(),
      lerpFrom:   [...initLms],
    };

    // ── RAF loop ────────────────────────────────────────────────────────────
    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      const s = stateRef.current!;

      // Slow pendulum rotation ±30°
      group.rotation.y = Math.sin(now * 0.00060 * Math.PI * 2 * 0.3) * 0.52;

      // Pulse the projector rings
      const pulse = 1 + Math.sin(now * 0.0018) * 0.07;
      rings[0].scale.set(pulse, 1, pulse);
      rings[1].scale.set(1 / pulse, 1, 1 / pulse);  // inner/outer breathe opposite
      ringMat.opacity = 0.18 + Math.sin(now * 0.0022) * 0.12;

      // Smooth pose lerp
      const t = Math.min((now - s.lerpStart) / LERP_MS, 1);
      if (t < 1) {
        const e = t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t;
        s.currentLms = lerp(s.lerpFrom, s.targetLms, e);
        updateMeshes(s.currentLms, s.joints, s.bones);
      }

      composer.render();
    };
    rafRef.current = requestAnimationFrame(tick);

    // ── Resize ──────────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      const nw = el.clientWidth, nh = el.clientHeight;
      if (!nw || !nh) return;
      renderer.setSize(nw, nh);
      composer.setSize(nw, nh);
      bloom.resolution.set(nw, nh);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      stateRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Letter change → animate to new pose ───────────────────────────────────
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    s.lerpFrom  = [...s.currentLms];
    s.targetLms = getLandmarks(letter || "A");
    s.lerpStart = performance.now();
  }, [letter]);

  return (
    <div
      ref={mountRef}
      style={{ width: "100%", height: "100%" }}
      className="rounded-xl overflow-hidden"
    />
  );
}
