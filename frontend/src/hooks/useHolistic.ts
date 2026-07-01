/**
 * useHolistic.ts — FaceLandmarker + PoseLandmarker only.
 *
 * Hand detection stays in useMediaPipe (already running). This hook
 * adds face + pose so we can build the 150-feature holistic vector.
 *
 * Models are loaded lazily when `enabled` is true and unloaded when false,
 * so idle cost is zero while in alphabet mode.
 *
 * Call detectFacePose() only during the collection window (~1 s) to avoid
 * running two heavy models every frame when the user is just waiting.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FaceLandmarker,
  PoseLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";

const WASM_LOCAL = "/mediapipe/wasm";
const FACE_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const POSE_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export type FacePoseResult = {
  faceLms: { x: number; y: number; z: number }[] | null;
  poseLms: { x: number; y: number; z: number }[] | null;
};

export function useHolistic(enabled: boolean) {
  const faceRef = useRef<FaceLandmarker | null>(null);
  const poseRef = useRef<PoseLandmarker | null>(null);
  const [ready, setReady] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setReady(false);
    setLoadingMsg("Downloading face + pose models (~10 MB, cached after first load)…");

    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_LOCAL);
        const [face, pose] = await Promise.all([
          FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: FACE_URL, delegate: "CPU" },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: false,
          }),
          PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: POSE_URL, delegate: "CPU" },
            runningMode: "VIDEO",
            numPoses: 1,
          }),
        ]);
        if (cancelled) { face.close(); pose.close(); return; }
        faceRef.current = face;
        poseRef.current = pose;
        setReady(true);
        setLoadingMsg(null);
      } catch (e) {
        if (!cancelled) setLoadingMsg("Holistic load failed: " + String(e));
      }
    })();

    return () => {
      cancelled = true;
      faceRef.current?.close();
      poseRef.current?.close();
      faceRef.current = null;
      poseRef.current = null;
      setReady(false);
    };
  }, [enabled]);

  // Call this only during the ~30-frame collection window, not every frame
  const detectFacePose = useCallback((video: HTMLVideoElement): FacePoseResult => {
    if (!ready || !faceRef.current || !poseRef.current)
      return { faceLms: null, poseLms: null };
    const ts = performance.now();
    const fRes = faceRef.current.detectForVideo(video, ts);
    const pRes = poseRef.current.detectForVideo(video, ts);
    return {
      faceLms: fRes.faceLandmarks?.[0] ?? null,
      poseLms: pRes.landmarks?.[0] ?? null,
    };
  }, [ready]);

  return { ready, loadingMsg, detectFacePose };
}
