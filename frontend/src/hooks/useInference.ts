/**
 * useInference.ts — builds the alphabet model directly in TF.js and loads
 * weights from the binary file produced by scripts/convert_model.py.
 *
 * We do NOT use tf.loadLayersModel() because Keras 3.x model.to_json()
 * produces a format that TF.js cannot parse. Instead we reconstruct the
 * exact architecture from train.py and set the weights manually.
 *
 * Architecture (from src/train.py):
 *   Input(63) → Dense(256,relu) → BN → Dropout(0.3)
 *             → Dense(128,relu) → BN → Dropout(0.3)
 *             → Dense(64,relu)  → BN → Dropout(0.3)
 *             → Dense(24,softmax)
 *
 * Binary weight order (same as Python's model.layers iteration):
 *   Dense256: kernel[63,256], bias[256]
 *   BN256:    gamma[256], beta[256], moving_mean[256], moving_var[256]
 *   Dense128: kernel[256,128], bias[128]
 *   BN128:    gamma[128], beta[128], moving_mean[128], moving_var[128]
 *   Dense64:  kernel[128,64], bias[64]
 *   BN64:     gamma[64], beta[64], moving_mean[64], moving_var[64]
 *   Dense24:  kernel[64,24], bias[24]
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as tf from "@tensorflow/tfjs";

export type Prediction = { letter: string; confidence: number } | null;

// 24 letters matching train.py label encoder (A-Y excluding J and Z)
const LABELS = "ABCDEFGHIKLMNOPQRSTUVWXY".split("");

const WEIGHTS_BIN = "/models/alphabet/group1-shard1of1.bin";

// Weight shapes in binary file order — must exactly match Python's iteration
const WEIGHT_SPECS: number[][] = [
  [63, 256], [256],             // Dense 256: kernel, bias
  [256], [256], [256], [256],   // BN 256: gamma, beta, moving_mean, moving_var
  [256, 128], [128],            // Dense 128: kernel, bias
  [128], [128], [128], [128],   // BN 128
  [128, 64], [64],              // Dense 64: kernel, bias
  [64], [64], [64], [64],       // BN 64
  [64, 24], [24],               // Dense 24 (output): kernel, bias
];

// Weights per TF.js layer (Dense=2, BN=4, Dropout=0) — model.layers order
const WEIGHTS_PER_LAYER = [2, 4, 0,  2, 4, 0,  2, 4, 0,  2];

function buildArch(): tf.Sequential {
  const m = tf.sequential();
  m.add(tf.layers.dense({ units: 256, activation: "relu", inputShape: [63] }));
  m.add(tf.layers.batchNormalization());
  m.add(tf.layers.dropout({ rate: 0.3 }));
  m.add(tf.layers.dense({ units: 128, activation: "relu" }));
  m.add(tf.layers.batchNormalization());
  m.add(tf.layers.dropout({ rate: 0.3 }));
  m.add(tf.layers.dense({ units: 64, activation: "relu" }));
  m.add(tf.layers.batchNormalization());
  m.add(tf.layers.dropout({ rate: 0.3 }));
  m.add(tf.layers.dense({ units: 24, activation: "softmax" }));
  return m;
}

async function applyWeights(model: tf.Sequential): Promise<void> {
  const resp = await fetch(WEIGHTS_BIN);
  if (!resp.ok) throw new Error(`Cannot load weights: ${resp.status} ${WEIGHTS_BIN}`);
  const buf = await resp.arrayBuffer();
  const flat = new Float32Array(buf);

  // Parse flat buffer into tensors in WEIGHT_SPECS order
  let offset = 0;
  const tensors: tf.Tensor[] = WEIGHT_SPECS.map((shape) => {
    const size = shape.reduce((a, b) => a * b, 1);
    const t = tf.tensor(flat.slice(offset, offset + size), shape);
    offset += size;
    return t;
  });

  // Assign tensors to layers
  let ti = 0;
  for (let li = 0; li < model.layers.length && li < WEIGHTS_PER_LAYER.length; li++) {
    const count = WEIGHTS_PER_LAYER[li];
    if (count > 0) {
      model.layers[li].setWeights(tensors.slice(ti, ti + count));
      ti += count;
    }
  }

  tensors.forEach((t) => t.dispose());

  const expected = flat.length;
  const consumed = offset;
  if (consumed !== expected) {
    console.warn(`[Inference] Weight size mismatch: consumed ${consumed} but file has ${expected} floats`);
  }
}

export function useInference() {
  const modelRef = useRef<tf.Sequential | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const model = buildArch();

        // Build (materialise weights) with a dummy pass before setting real weights
        const dummy = tf.zeros([1, 63]);
        (model.predict(dummy) as tf.Tensor).dispose();
        dummy.dispose();

        await applyWeights(model);

        // Warm-up with real weights
        const warm = tf.zeros([1, 63]);
        (model.predict(warm) as tf.Tensor).dispose();
        warm.dispose();

        if (!cancelled) {
          modelRef.current = model;
          setReady(true);
          console.log("[Inference] Alphabet model loaded and ready.");
        }
      } catch (e) {
        if (!cancelled) {
          console.error("[Inference] Load failed:", e);
          setError(String(e));
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const predict = useCallback((features: Float32Array): Prediction => {
    if (!modelRef.current || !ready) return null;
    return tf.tidy(() => {
      const input = tf.tensor2d([Array.from(features)], [1, 63]);
      const probs = (modelRef.current!.predict(input) as tf.Tensor).dataSync() as Float32Array;
      let maxIdx = 0, maxVal = probs[0];
      for (let i = 1; i < probs.length; i++) {
        if (probs[i] > maxVal) { maxVal = probs[i]; maxIdx = i; }
      }
      return { letter: LABELS[maxIdx] ?? "?", confidence: maxVal };
    });
  }, [ready]);

  return { ready, error, predict };
}
