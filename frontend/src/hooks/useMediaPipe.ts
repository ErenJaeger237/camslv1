/**
 * useMediaPipe.ts — HandLandmarker running in the browser.
 *
 * WASM served locally from /mediapipe/wasm/ (no CDN dependency).
 * Model downloaded from Google's CDN once, then browser-cached.
 * Tries GPU delegate first, silently falls back to CPU.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HandLandmarker,
  FilesetResolver,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { RawLandmark } from "../lib/landmarks";

// Served from public/mediapipe/wasm/ — no network needed after npm install
const WASM_LOCAL = "/mediapipe/wasm";

// Model from Google CDN — ~8 MB, cached by browser after first download
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
  const [loadingMsg, setLoadingMsg] = useState("Initialising hand detection…");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoadingMsg("Loading WASM runtime…");
        const vision = await FilesetResolver.forVisionTasks(WASM_LOCAL);

        setLoadingMsg("Downloading hand model (~8 MB, cached after first load)…");

        let hl: HandLandmarker;
        try {
          hl = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
            runningMode: "VIDEO",
            numHands: 1,
          });
        } catch {
          // GPU unavailable — fall back to CPU silently
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
        if (!cancelled) {
          console.error("[MediaPipe] init failed:", e);
          setError(String(e));
        }
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
