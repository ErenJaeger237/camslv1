/**
 * Hand3D.tsx — toon-shaded 3D hand that shows the correct ASL pose for a letter.
 *
 * Uses Three.js (already installed) with:
 *  - MeshToonMaterial + 2-step gradient map (cel-shading)
 *  - Inverted-hull outline on every mesh
 *  - Forward kinematics from handPoses.ts
 *  - Slow pendulum rotation so the user sees the shape from all angles
 *  - Smooth LERP transition when the letter changes
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { getLandmarks, HAND_CONNECTIONS } from "../lib/handPoses";

const SKIN    = 0xffcba4;
const TIP_COL = 0xff9977;
const BONE_COL= 0xffb899;
const OUTLINE = 0x0d1b2a;

const JOINT_R = 0.024;
const TIP_R   = 0.030;
const BONE_R  = 0.016;
const TIP_IDS = new Set([4, 8, 12, 16, 20]);
const LERP_MS = 450;

function makeGradMap(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 2; c.height = 1;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#404040"; ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = "#d0d0d0"; ctx.fillRect(1, 0, 1, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  return tex;
}

function withOutline(mesh: THREE.Mesh, scale = 1.10): void {
  const ol = new THREE.Mesh(
    mesh.geometry,
    new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide }),
  );
  ol.scale.setScalar(scale);
  mesh.add(ol);
}

function buildJoints(
  gradMap: THREE.CanvasTexture,
  scene: THREE.Group,
): THREE.Mesh[] {
  const joints: THREE.Mesh[] = [];
  const skinMat = new THREE.MeshToonMaterial({ color: SKIN, gradientMap: gradMap });
  const tipMat  = new THREE.MeshToonMaterial({ color: TIP_COL, gradientMap: gradMap });

  for (let i = 0; i < 21; i++) {
    const r = TIP_IDS.has(i) ? TIP_R : JOINT_R;
    const mat = TIP_IDS.has(i) ? tipMat : skinMat;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
    withOutline(mesh, 1.15);
    scene.add(mesh);
    joints.push(mesh);
  }
  return joints;
}

function buildBones(
  n: number,
  gradMap: THREE.CanvasTexture,
  scene: THREE.Group,
): THREE.Mesh[] {
  const bones: THREE.Mesh[] = [];
  const boneMat = new THREE.MeshToonMaterial({ color: BONE_COL, gradientMap: gradMap });
  for (let i = 0; i < n; i++) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(BONE_R, BONE_R, 1, 8),
      boneMat,
    );
    withOutline(mesh, 1.18);
    scene.add(mesh);
    bones.push(mesh);
  }
  return bones;
}

const _up = new THREE.Vector3(0, 1, 0);
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _mid = new THREE.Vector3();

function updateMeshes(
  lms: number[],
  joints: THREE.Mesh[],
  bones: THREE.Mesh[],
): void {
  for (let i = 0; i < 21; i++) {
    joints[i].position.set(lms[i * 3], lms[i * 3 + 1], lms[i * 3 + 2]);
  }
  for (let bi = 0; bi < HAND_CONNECTIONS.length; bi++) {
    const [a, b] = HAND_CONNECTIONS[bi];
    _pa.set(lms[a*3], lms[a*3+1], lms[a*3+2]);
    _pb.set(lms[b*3], lms[b*3+1], lms[b*3+2]);
    _mid.copy(_pa).add(_pb).multiplyScalar(0.5);
    const len = _pa.distanceTo(_pb);
    bones[bi].position.copy(_mid);
    bones[bi].scale.set(1, len, 1);
    const dir = _pb.clone().sub(_pa).normalize();
    bones[bi].quaternion.setFromUnitVectors(_up, dir);
  }
}

function lerp(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => v + (b[i] - v) * t);
}

export function Hand3D({ letter }: { letter: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rafRef   = useRef<number>(0);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    group: THREE.Group;
    joints: THREE.Mesh[];
    bones: THREE.Mesh[];
    currentLms: number[];
    targetLms: number[];
    lerpStart: number;
    lerpFrom: number[];
  } | null>(null);

  // ── Init Three.js scene ────────────────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const w = el.clientWidth || 200;
    const h = el.clientHeight || 200;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(48, w / h, 0.01, 20);
    camera.position.set(0.18, 0.45, 0.82);
    camera.lookAt(0, 0.18, 0);

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(1.5, 2, 2);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x88bbff, 0.4);
    fill.position.set(-1, 0, 1);
    scene.add(fill);

    // Hand group (we rotate this)
    const group = new THREE.Group();
    group.position.set(0, -0.12, 0);
    scene.add(group);

    const gradMap = makeGradMap();
    const joints  = buildJoints(gradMap, group);
    const bones   = buildBones(HAND_CONNECTIONS.length, gradMap, group);

    const initLms = getLandmarks(letter || "A");
    updateMeshes(initLms, joints, bones);

    const state = {
      renderer, scene, camera, group, joints, bones,
      currentLms: [...initLms],
      targetLms:  [...initLms],
      lerpStart: performance.now(),
      lerpFrom:  [...initLms],
    };
    stateRef.current = state;

    // ── RAF loop ────────────────────────────────────────────────────────────
    let lastT = performance.now();
    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      const dt = (now - lastT) / 1000;
      lastT = now;

      // Pendulum rotation: ±30° at 0.3 cycles/sec
      group.rotation.y = Math.sin(now * 0.0006 * Math.PI * 2 * 0.3) * 0.52;

      // Smooth lerp between poses
      const elapsed = now - state.lerpStart;
      const t = Math.min(elapsed / LERP_MS, 1);
      if (t < 1) {
        const eased = t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t; // ease in-out quad
        state.currentLms = lerp(state.lerpFrom, state.targetLms, eased);
        updateMeshes(state.currentLms, state.joints, state.bones);
      }

      renderer.render(scene, camera);
    };
    rafRef.current = requestAnimationFrame(tick);

    // ── Resize ──────────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      const nw = el.clientWidth, nh = el.clientHeight;
      if (nw && nh) {
        renderer.setSize(nw, nh);
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
      }
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

  // ── Update pose when letter changes ───────────────────────────────────────
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
