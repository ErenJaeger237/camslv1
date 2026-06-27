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

export type DetectAllResult = {
  hands: Array<{ landmarks: RawLandmark[]; handedness: string }>;
};

/**
 * numHands: pass 2 to enable two-hand detection for word-sign contribution mode.
 * The landmarker is recreated when numHands changes — WASM and the model file
 * are browser-cached after the first load, so subsequent inits are fast (<500 ms).
 */
export function useMediaPipe(numHands: 1 | 2 = 1) {
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMsg, setLoadingMsg] = useState("Initialising hand detection…");

  useEffect(() => {
    let cancelled = false;
    setReady(false);

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
            numHands,
          });
        } catch {
          // GPU unavailable — fall back to CPU silently
          hl = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
            runningMode: "VIDEO",
            numHands,
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
  }, [numHands]); // Recreated when numHands changes (mode switch)

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

  // Returns all detected hands — used in word-sign mode (numHands=2)
  const detectAll = useCallback(
    (video: HTMLVideoElement): DetectAllResult => {
      if (!landmarkerRef.current || !ready) return { hands: [] };
      const result: HandLandmarkerResult =
        landmarkerRef.current.detectForVideo(video, performance.now());
      if (!result.landmarks?.length) return { hands: [] };
      return {
        hands: result.landmarks.map((lms, i) => ({
          landmarks: lms as RawLandmark[],
          handedness: result.handedness?.[i]?.[0]?.categoryName ?? "Right",
        })),
      };
    },
    [ready],
  );

  return { ready, error, loadingMsg, detect, detectAll };
}
