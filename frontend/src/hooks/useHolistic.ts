/**
 * useHolistic.ts — Hand + Face + Pose MediaPipe landmarkers running together.
 *
 * Loaded lazily (only when word-signs mode is activated) to avoid slowing
 * down the initial page load.  Models are fetched from Google CDN once and
 * then browser-cached indefinitely.
 *
 * Face model  ~4 MB   (face_landmarker/float16)
 * Pose model  ~6 MB   (pose_landmarker_lite/float16)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HandLandmarker,
  FaceLandmarker,
  PoseLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";
import { buildHolisticFeatures, NUM_HOLISTIC } from "../lib/holisticLandmarks";

const WASM_LOCAL = "/mediapipe/wasm";

const HAND_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const FACE_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const POSE_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export { NUM_HOLISTIC };

export function useHolistic(enabled: boolean) {
  const handRef = useRef<HandLandmarker | null>(null);
  const faceRef = useRef<FaceLandmarker | null>(null);
  const poseRef = useRef<PoseLandmarker | null>(null);
  const [ready, setReady] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setReady(false);
    setLoadingMsg("Downloading holistic models (face ~4 MB, pose ~6 MB)…");

    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_LOCAL);

        // Load all three models in parallel — browser caches them after first fetch
        const [hand, face, pose] = await Promise.all([
          HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HAND_URL, delegate: "CPU" },
            runningMode: "VIDEO",
            numHands: 1,
          }),
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

        if (cancelled) {
          hand.close();
          face.close();
          pose.close();
          return;
        }

        handRef.current = hand;
        faceRef.current = face;
        poseRef.current = pose;
        setReady(true);
        setLoadingMsg(null);
      } catch (e) {
        if (!cancelled) {
          console.error("[Holistic] init failed:", e);
          setLoadingMsg("Failed to load holistic models: " + String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      handRef.current?.close();
      faceRef.current?.close();
      poseRef.current?.close();
      handRef.current = null;
      faceRef.current = null;
      poseRef.current = null;
      setReady(false);
    };
  }, [enabled]);

  const detectHolistic = useCallback(
    (video: HTMLVideoElement): Float32Array | null => {
      if (!ready || !handRef.current || !faceRef.current || !poseRef.current) return null;
      const ts = performance.now();

      const hRes = handRef.current.detectForVideo(video, ts);
      const fRes = faceRef.current.detectForVideo(video, ts);
      const pRes = poseRef.current.detectForVideo(video, ts);

      return buildHolisticFeatures(
        hRes.landmarks?.[0] ?? null,
        fRes.faceLandmarks?.[0] ?? null,
        pRes.landmarks?.[0] ?? null,
      );
    },
    [ready],
  );

  return { ready, loadingMsg, detectHolistic };
}
