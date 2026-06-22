"""
convert_model.py — converts models/alphabet.keras → TF.js format.

Output goes into frontend/public/models/alphabet/
which Vite will serve as static assets in production.

Run from the project root (with venv activated):
    python scripts/convert_model.py

Requirements (already in venv):
    pip install tensorflowjs
"""

import sys
import subprocess
from pathlib import Path

ROOT = Path(__file__).parent.parent
KERAS_MODEL = ROOT / "models" / "alphabet.keras"
TFJS_OUT = ROOT / "frontend" / "public" / "models" / "alphabet"


def main():
    if not KERAS_MODEL.exists():
        print(f"[ERROR] Model not found: {KERAS_MODEL}")
        print("Run:  python src/train.py  first to generate it.")
        sys.exit(1)

    TFJS_OUT.mkdir(parents=True, exist_ok=True)
    print(f"Converting {KERAS_MODEL} → {TFJS_OUT}")

    result = subprocess.run(
        [
            sys.executable, "-m", "tensorflowjs_converter",
            "--input_format", "keras",
            "--output_format", "tfjs_layers_model",
            str(KERAS_MODEL),
            str(TFJS_OUT),
        ],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        print("[ERROR] Conversion failed:")
        print(result.stderr)
        sys.exit(1)

    files = list(TFJS_OUT.glob("**/*"))
    total_kb = sum(f.stat().st_size for f in files if f.is_file()) // 1024
    print(f"Done — {len(files)} files, {total_kb} KB")
    print(f"Model URL in frontend:  /models/alphabet/model.json")


if __name__ == "__main__":
    main()
