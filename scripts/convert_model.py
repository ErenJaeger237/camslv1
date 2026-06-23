"""
convert_model.py — converts models/alphabet.keras → TF.js LayersModel format.

Uses only TensorFlow (already in the venv). No tensorflowjs package required.

The TF.js LayersModel format is:
  model.json        — architecture (Keras JSON config) + weight manifest
  group1-shard1of1.bin — all weights packed as little-endian float32

Run from the project root (with venv activated):
    python scripts/convert_model.py
"""

import sys
import json
import struct
from pathlib import Path

ROOT = Path(__file__).parent.parent
KERAS_MODEL = ROOT / "models" / "alphabet.keras"
TFJS_OUT = ROOT / "frontend" / "public" / "models" / "alphabet"


def main():
    if not KERAS_MODEL.exists():
        print(f"[ERROR] Model not found: {KERAS_MODEL}")
        print("Run:  python src/train.py  first.")
        sys.exit(1)

    try:
        import tensorflow as tf
        import numpy as np
    except ImportError as e:
        print(f"[ERROR] {e}")
        sys.exit(1)

    print(f"Loading {KERAS_MODEL} ...")
    model = tf.keras.models.load_model(str(KERAS_MODEL))
    model.summary()

    TFJS_OUT.mkdir(parents=True, exist_ok=True)

    # ── Collect weights ──────────────────────────────────────────────────────
    weight_specs = []
    raw_parts = []

    for layer in model.layers:
        for w in layer.weights:
            arr = w.numpy().astype(np.float32)
            weight_specs.append({
                "name": w.name,
                "shape": list(arr.shape),
                "dtype": "float32",
            })
            raw_parts.append(arr.tobytes())

    bin_name = "group1-shard1of1.bin"
    bin_path = TFJS_OUT / bin_name
    with open(bin_path, "wb") as f:
        for part in raw_parts:
            f.write(part)

    total_bytes = sum(len(p) for p in raw_parts)
    print(f"Wrote {total_bytes / 1024:.1f} KB weights → {bin_name}")

    # ── Write model.json ─────────────────────────────────────────────────────
    topology = json.loads(model.to_json())

    model_json = {
        "format": "layers-model",
        "generatedBy": f"keras {tf.__version__}",
        "convertedBy": "scripts/convert_model.py (custom)",
        "modelTopology": topology,
        "weightsManifest": [
            {
                "paths": [bin_name],
                "weights": weight_specs,
            }
        ],
    }

    json_path = TFJS_OUT / "model.json"
    with open(json_path, "w") as f:
        json.dump(model_json, f)

    print(f"Wrote model.json")
    print(f"\nDone — model at frontend/public/models/alphabet/model.json")
    print(f"Refresh the browser; the 'TF.js ✓' badge should appear.")


if __name__ == "__main__":
    main()
