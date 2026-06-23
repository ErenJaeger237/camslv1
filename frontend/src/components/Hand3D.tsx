import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer }  from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass }      from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass }      from "three/examples/jsm/postprocessing/OutputPass.js";
import { getLandmarks, HAND_CONNECTIONS } from "../lib/handPoses";

const CYAN    = 0x00f3ff;
const BG      = 0x020b18;
const JOINT_R = 0.030;
const TIP_R   = 0.038;
const BONE_R  = 0.018;
const TIP_IDS = new Set([4, 8, 12, 16, 20]);
const LERP_MS = 450;

const _pa  = new THREE.Vector3();
const _pb  = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up  = new THREE.Vector3(0, 1, 0);

const JOINT_EDGE_GEO = new THREE.EdgesGeometry(new THREE.SphereGeometry(1, 10, 7));
const BONE_EDGE_GEO  = new THREE.EdgesGeometry(new THREE.CylinderGeometry(1, 1, 1, 8));

function lerp(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => v + (b[i] - v) * t);
}

function updateMeshes(
  lms:    number[],
  joints: THREE.LineSegments[],
  bones:  THREE.LineSegments[],
): void {
  for (let i = 0; i < 21; i++) {
    joints[i].position.set(lms[i * 3], lms[i * 3 + 1], lms[i * 3 + 2]);
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
  }
}

export function Hand3D({ letter }: { letter: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rafRef   = useRef<number>(0);

  const stateRef = useRef<{
    renderer:   THREE.WebGLRenderer;
    composer:   EffectComposer;
    bloom:      UnrealBloomPass;
    camera:     THREE.PerspectiveCamera;
    group:      THREE.Group;
    joints:     THREE.LineSegments[];
    bones:      THREE.LineSegments[];
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

    const wireMat = new THREE.LineBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.90,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    const ringMat = new THREE.LineBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    const group = new THREE.Group();
    group.position.set(0, -0.3, 0);
    scene.add(group);

    const joints: THREE.LineSegments[] = [];
    for (let i = 0; i < 21; i++) {
      const r    = TIP_IDS.has(i) ? TIP_R : JOINT_R;
      const mesh = new THREE.LineSegments(JOINT_EDGE_GEO, wireMat);
      mesh.scale.setScalar(r);
      group.add(mesh);
      joints.push(mesh);
    }

    const bones: THREE.LineSegments[] = [];
    for (let i = 0; i < HAND_CONNECTIONS.length; i++) {
      const mesh = new THREE.LineSegments(BONE_EDGE_GEO, wireMat);
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

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.25, 0.22);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const initLms = getLandmarks(letter || "A");
    updateMeshes(initLms, joints, bones);

    stateRef.current = {
      renderer, composer, bloom, camera, group,
      joints, bones, ringMat, rings,
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
        updateMeshes(s.currentLms, s.joints, s.bones);
      }

      composer.render();
    };
    rafRef.current = requestAnimationFrame(tick);

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
