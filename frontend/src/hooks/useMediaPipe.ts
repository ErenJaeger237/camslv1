/**
 * useMediaPipe.ts — HandLandmarker in the browser via WASM.
 * Tries GPU delegate first, falls back to CPU automatically.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HandLandmarker,
  FilesetResolver,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { RawLandmark } from "../lib/landmarks";

const WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export type DetectResult = {
  landmarks: RawLandmark[] | null;
  handedness: string | null;
};

export function useMediaPipe() {
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMsg, setLoadingMsg] = useState("Downloading MediaPipe model…");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoadingMsg("Loading WASM runtime…");
        const vision = await FilesetResolver.forVisionTasks(WASM_CDN);

        setLoadingMsg("Loading hand detection model…");

        // Try GPU first; fall back to CPU silently
        let hl: HandLandmarker;
        try {
          hl = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
            runningMode: "VIDEO",
            numHands: 1,
          });
        } catch {
          hl = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
            runningMode: "VIDEO",
            numHands: 1,
          });
        }

        if (cancelled) { hl.close(); return; }
        landmarkerRef.current = hl;
        setReady(true);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();

    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  const detect = useCallback(
    (video: HTMLVideoElement): DetectResult => {
      if (!landmarkerRef.current || !ready) return { landmarks: null, handedness: null };
      const result: HandLandmarkerResult =
        landmarkerRef.current.detectForVideo(video, performance.now());
      if (!result.landmarks?.length) return { landmarks: null, handedness: null };
      return {
        landmarks: result.landmarks[0] as RawLandmark[],
        handedness: result.handedness?.[0]?.[0]?.categoryName ?? null,
      };
    },
    [ready],
  );

  return { ready, error, loadingMsg, detect };
}
