import { useEffect, useRef } from "react";
import * as THREE from "three";
import { getLandmarks, HAND_CONNECTIONS } from "../lib/handPoses";

// ── Wireframe cage ────────────────────────────────────────────────────────────
const JOINT_R = 0.030;
const TIP_R   = 0.038;
const BONE_R  = 0.018;

// ── Skin tubes ────────────────────────────────────────────────────────────────
const SKIN_JOINT_R = 0.105;
const SKIN_TIP_R   = 0.115;
const SKIN_BONE_R  = 0.098;

const CYAN    = 0x00f3ff;
const BG      = 0x020b18;
const TIP_IDS = new Set([4, 8, 12, 16, 20]);
const LERP_MS = 450;

// Reusable vectors — no per-frame heap allocations
const _pa  = new THREE.Vector3();
const _pb  = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up  = new THREE.Vector3(0, 1, 0);

// Shared geometries (created once, reused across all instances)
const JOINT_EDGE_GEO = new THREE.EdgesGeometry(new THREE.SphereGeometry(1, 10, 7));
const BONE_EDGE_GEO  = new THREE.EdgesGeometry(new THREE.CylinderGeometry(1, 1, 1, 8));
const SKIN_JOINT_GEO = new THREE.SphereGeometry(1, 14, 10);
const SKIN_BONE_GEO  = new THREE.CylinderGeometry(1, 1, 1, 10);

function lerp(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => v + (b[i] - v) * t);
}

function updateMeshes(
  lms:        number[],
  joints:     THREE.LineSegments[],
  bones:      THREE.LineSegments[],
  skinJoints: THREE.Mesh[],
  skinBones:  THREE.Mesh[],
): void {
  for (let i = 0; i < 21; i++) {
    const x = lms[i*3], y = lms[i*3+1], z = lms[i*3+2];
    joints[i].position.set(x, y, z);
    skinJoints[i].position.set(x, y, z);
  }
  for (let bi = 0; bi < HAND_CONNECTIONS.length; bi++) {
    const [a, b] = HAND_CONNECTIONS[bi];
    _pa.set(lms[a*3], lms[a*3+1], lms[a*3+2]);
    _pb.set(lms[b*3], lms[b*3+1], lms[b*3+2]);
    _dir.subVectors(_pb, _pa).normalize();
    _mid.addVectors(_pa, _pb).multiplyScalar(0.5);
    const len = _pa.distanceTo(_pb);

    bones[bi].position.copy(_mid);
    bones[bi].scale.set(BONE_R, len, BONE_R);
    bones[bi].quaternion.setFromUnitVectors(_up, _dir);

    skinBones[bi].position.copy(_mid);
    skinBones[bi].scale.set(SKIN_BONE_R, len, SKIN_BONE_R);
    skinBones[bi].quaternion.copy(bones[bi].quaternion);
  }
}

export function Hand3D({ letter }: { letter: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rafRef   = useRef<number>(0);

  const stateRef = useRef<{
    renderer:   THREE.WebGLRenderer;
    scene:      THREE.Scene;
    camera:     THREE.PerspectiveCamera;
    group:      THREE.Group;
    joints:     THREE.LineSegments[];
    bones:      THREE.LineSegments[];
    skinJoints: THREE.Mesh[];
    skinBones:  THREE.Mesh[];
    ringMat:    THREE.LineBasicMaterial;
    rings:      THREE.LineLoop[];
    currentLms: number[];
    targetLms:  number[];
    lerpStart:  number;
    lerpFrom:   number[];
  } | null>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const w = el.clientWidth  || 300;
    const h = el.clientHeight || 300;

    // ── Renderer — no post-processing, plain render() ─────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(BG, 1);
    el.appendChild(renderer.domElement);

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, w / h, 0.01, 30);
    camera.position.set(0.4, 1.2, 2.8);
    camera.lookAt(0, 0.9, 0);

    const skinMat = new THREE.MeshBasicMaterial({
      color:       CYAN,
      transparent: true,
      opacity:     0.38,
      side:        THREE.DoubleSide,
      depthWrite:  false,
      depthTest:   false,
    });

    const wireMat = new THREE.LineBasicMaterial({
      color:       CYAN,
      transparent: true,
      opacity:     0.95,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
    });

    const ringMat = new THREE.LineBasicMaterial({
      color:       CYAN,
      transparent: true,
      opacity:     0.25,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
    });

    const group = new THREE.Group();
    group.position.set(0, -0.3, 0);
    scene.add(group);

    const skinJoints: THREE.Mesh[] = [];
    for (let i = 0; i < 21; i++) {
      const r    = TIP_IDS.has(i) ? SKIN_TIP_R : SKIN_JOINT_R;
      const mesh = new THREE.Mesh(SKIN_JOINT_GEO, skinMat);
      mesh.scale.setScalar(r);
      mesh.renderOrder = 0;
      group.add(mesh);
      skinJoints.push(mesh);
    }

    const skinBones: THREE.Mesh[] = [];
    for (let i = 0; i < HAND_CONNECTIONS.length; i++) {
      const mesh = new THREE.Mesh(SKIN_BONE_GEO, skinMat);
      mesh.renderOrder = 0;
      group.add(mesh);
      skinBones.push(mesh);
    }

    const joints: THREE.LineSegments[] = [];
    for (let i = 0; i < 21; i++) {
      const r    = TIP_IDS.has(i) ? TIP_R : JOINT_R;
      const mesh = new THREE.LineSegments(JOINT_EDGE_GEO, wireMat);
      mesh.scale.setScalar(r);
      mesh.renderOrder = 1;
      group.add(mesh);
      joints.push(mesh);
    }

    const bones: THREE.LineSegments[] = [];
    for (let i = 0; i < HAND_CONNECTIONS.length; i++) {
      const mesh = new THREE.LineSegments(BONE_EDGE_GEO, wireMat);
      mesh.renderOrder = 1;
      group.add(mesh);
      bones.push(mesh);
    }

    const rings: THREE.LineLoop[] = [];
    for (const r of [0.28, 0.40]) {
      const pts = Array.from({ length: 64 }, (_, i) => {
        const a = (i / 64) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      });
      const loop = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        ringMat,
      );
      loop.position.y = 0.04;
      group.add(loop);
      rings.push(loop);
    }

    const initLms = getLandmarks(letter || "A");
    updateMeshes(initLms, joints, bones, skinJoints, skinBones);

    stateRef.current = {
      renderer, scene, camera, group,
      joints, bones, skinJoints, skinBones,
      ringMat, rings,
      currentLms: [...initLms],
      targetLms:  [...initLms],
      lerpStart:  performance.now(),
      lerpFrom:   [...initLms],
    };

    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      const s = stateRef.current!;

      group.rotation.y = Math.sin(now * 0.00060 * Math.PI * 2 * 0.3) * 0.52;

      const pulse = 1 + Math.sin(now * 0.0018) * 0.07;
      rings[0].scale.set(pulse, 1, pulse);
      rings[1].scale.set(1 / pulse, 1, 1 / pulse);
      s.ringMat.opacity = 0.18 + Math.sin(now * 0.0022) * 0.10;

      const t = Math.min((now - s.lerpStart) / LERP_MS, 1);
      if (t < 1) {
        const e = t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t;
        s.currentLms = lerp(s.lerpFrom, s.targetLms, e);
        updateMeshes(s.currentLms, s.joints, s.bones, s.skinJoints, s.skinBones);
      }

      // Plain render — no bloom post-processing (avoids shader compilation on mount)
      renderer.render(scene, camera);
    };
    rafRef.current = requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => {
      const nw = el.clientWidth, nh = el.clientHeight;
      if (!nw || !nh) return;
      renderer.setSize(nw, nh);
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
      style={{ width: "100%", height: "100%", filter: "drop-shadow(0 0 8px rgba(0,243,255,0.45))" }}
      className="rounded-xl overflow-hidden"
    />
  );
}
