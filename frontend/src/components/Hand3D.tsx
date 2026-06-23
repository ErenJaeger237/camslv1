/**
 * Hand3D.tsx — holographic 3D hand model.
 *
 * Visual pipeline:
 *   1. ShaderMaterial (Fresnel edge-glow + scrolling scanlines) on joints
 *   2. LineBasicMaterial (AdditiveBlending) on bone connections
 *   3. EffectComposer → UnrealBloomPass → OutputPass
 *
 * Background is solid dark navy — bloom requires a dark opaque surface
 * to bleed light into; a transparent canvas produces no visible glow.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { getLandmarks, HAND_CONNECTIONS } from "../lib/handPoses";

// ── Visual constants ───────────────────────────────────────────────────────────
const HOLO_COLOR = new THREE.Color(0x00f3ff);   // neon cyan
const BG_COLOR   = 0x020b18;                    // deep dark navy
const JOINT_R    = 0.024;
const TIP_R      = 0.032;
const TIP_IDS    = new Set([4, 8, 12, 16, 20]);
const LERP_MS    = 450;

// ── GLSL: Fresnel edge-glow + scanlines ───────────────────────────────────────
const VERT = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vWorldPos;

  void main() {
    vec4 mvPos  = modelViewMatrix * vec4(position, 1.0);
    vNormal     = normalize(normalMatrix * normal);
    vViewDir    = normalize(-mvPos.xyz);
    vWorldPos   = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const FRAG = /* glsl */`
  uniform float uTime;
  uniform vec3  uColor;

  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vWorldPos;

  void main() {
    // Fresnel — edges bright, centre transparent
    float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.5);

    // Scrolling horizontal scanlines (world-space Y so they stay put as hand rotates)
    float scan = sin(vWorldPos.y * 22.0 - uTime * 2.8) * 0.5 + 0.5;
    scan = scan * scan * scan;                  // sharpen the bands

    float brightness = fresnel + scan * 0.35 + 0.06;
    float alpha      = clamp(fresnel * 0.9 + scan * 0.25 + 0.06, 0.0, 1.0);

    gl_FragColor = vec4(uColor * brightness, alpha);
  }
`;

// ── Helpers ────────────────────────────────────────────────────────────────────
function lerp(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => v + (b[i] - v) * t);
}

function updateMeshes(
  lms: number[],
  joints: THREE.Mesh[],
  boneGeos: THREE.BufferGeometry[],
): void {
  // Move joint spheres
  for (let i = 0; i < 21; i++) {
    joints[i].position.set(lms[i * 3], lms[i * 3 + 1], lms[i * 3 + 2]);
  }
  // Update bone line endpoints directly in the buffer
  for (let bi = 0; bi < HAND_CONNECTIONS.length; bi++) {
    const [a, b] = HAND_CONNECTIONS[bi];
    const arr = boneGeos[bi].attributes.position.array as Float32Array;
    arr[0] = lms[a * 3];     arr[1] = lms[a * 3 + 1]; arr[2] = lms[a * 3 + 2];
    arr[3] = lms[b * 3];     arr[4] = lms[b * 3 + 1]; arr[5] = lms[b * 3 + 2];
    boneGeos[bi].attributes.position.needsUpdate = true;
  }
}

// ── Component ──────────────────────────────────────────────────────────────────
export function Hand3D({ letter }: { letter: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rafRef   = useRef<number>(0);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    composer: EffectComposer;
    group: THREE.Group;
    joints: THREE.Mesh[];
    boneGeos: THREE.BufferGeometry[];
    holoMat: THREE.ShaderMaterial;
    ringMat: THREE.MeshBasicMaterial;
    ring: THREE.Mesh;
    camera: THREE.PerspectiveCamera;
    bloom: UnrealBloomPass;
    currentLms: number[];
    targetLms: number[];
    lerpStart: number;
    lerpFrom: number[];
  } | null>(null);

  // ── Init scene ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const w = el.clientWidth  || 300;
    const h = el.clientHeight || 300;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(BG_COLOR, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    el.appendChild(renderer.domElement);

    // Scene + camera
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, w / h, 0.01, 30);
    camera.position.set(0.4, 1.2, 2.8);
    camera.lookAt(0, 0.9, 0);

    // ── Materials ────────────────────────────────────────────────────────────
    const holoMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:  { value: 0 },
        uColor: { value: HOLO_COLOR.clone() },
      },
      vertexShader:   VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      side:        THREE.DoubleSide,
    });

    const lineMat = new THREE.LineBasicMaterial({
      color: 0x00f3ff,
      transparent: true,
      opacity: 0.65,
      blending:   THREE.AdditiveBlending,
      depthWrite: false,
    });

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00f3ff,
      transparent: true,
      opacity: 0.22,
      side:       THREE.DoubleSide,
      blending:   THREE.AdditiveBlending,
      depthWrite: false,
    });

    // ── Hand group ────────────────────────────────────────────────────────────
    const group = new THREE.Group();
    group.position.set(0, -0.3, 0);
    scene.add(group);

    // Joints (spheres with Fresnel shader)
    const joints: THREE.Mesh[] = [];
    for (let i = 0; i < 21; i++) {
      const r    = TIP_IDS.has(i) ? TIP_R : JOINT_R;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), holoMat);
      group.add(mesh);
      joints.push(mesh);
    }

    // Bones (line segments — no cylinders needed, bloom makes them glow)
    const boneGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < HAND_CONNECTIONS.length; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      group.add(new THREE.Line(geo, lineMat));
      boneGeos.push(geo);
    }

    // Atmospheric projector ring at wrist level
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.30, 64),
      ringMat,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    group.add(ring);

    // ── Post-processing ───────────────────────────────────────────────────────
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 1.5, 0.4, 0.10);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // ── Initial pose ──────────────────────────────────────────────────────────
    const initLms = getLandmarks(letter || "A");
    updateMeshes(initLms, joints, boneGeos);

    stateRef.current = {
      renderer, composer, group, joints, boneGeos,
      holoMat, ringMat, ring, camera, bloom,
      currentLms: [...initLms],
      targetLms:  [...initLms],
      lerpStart:  performance.now(),
      lerpFrom:   [...initLms],
    };

    // ── RAF loop ──────────────────────────────────────────────────────────────
    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      const s = stateRef.current!;

      // Slow pendulum rotation (±30°)
      group.rotation.y = Math.sin(now * 0.00060 * Math.PI * 2 * 0.3) * 0.52;

      // Pulsing projector ring
      const pulse = 1 + Math.sin(now * 0.0015) * 0.09;
      s.ring.scale.set(pulse, 1, pulse);
      s.ringMat.opacity = 0.15 + Math.sin(now * 0.0020) * 0.10;

      // Advance scanline time
      s.holoMat.uniforms.uTime.value = now * 0.001;

      // Smooth pose lerp
      const t = Math.min((now - s.lerpStart) / LERP_MS, 1);
      if (t < 1) {
        const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        s.currentLms = lerp(s.lerpFrom, s.targetLms, e);
        updateMeshes(s.currentLms, s.joints, s.boneGeos);
      }

      composer.render();
    };
    rafRef.current = requestAnimationFrame(tick);

    // ── Resize ────────────────────────────────────────────────────────────────
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

  // ── Letter change → update target pose ────────────────────────────────────
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
