/**
 * useMediaPipe.ts — runs HandLandmarker in the browser via WASM.
 *
 * Uses the npm @mediapipe/tasks-vision package. WASM binaries are loaded
 * from the CDN so they don't bloat the Vite bundle.
 *
 * Returns a `detect(video)` function you call each animation frame.
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
        const hl = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 1,
        });
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
      if (!landmarkerRef.current || !ready) {
        return { landmarks: null, handedness: null };
      }
      const result: HandLandmarkerResult =
        landmarkerRef.current.detectForVideo(video, performance.now());

      if (!result.landmarks || result.landmarks.length === 0) {
        return { landmarks: null, handedness: null };
      }
      return {
        landmarks: result.landmarks[0] as RawLandmark[],
        handedness: result.handedness?.[0]?.[0]?.categoryName ?? null,
      };
    },
    [ready],
  );

  return { ready, error, detect };
}
