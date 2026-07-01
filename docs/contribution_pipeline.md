# CamSL Contribution Pipeline

How user-contributed signs are captured, stored, and fed back into the AI models.

---

## Channel 1 — Alphabet Letters (fully wired)

```
User performs a letter sign in the app
        ↓
Frontend captures 63 features (21 hand landmarks × x,y,z — 1 static frame)
        ↓
POST /api/contributions
        ↓
backend/data/contributions.csv  (columns: timestamp, label, features)
        ↓
Every 25 new contributions → auto-triggers background retraining
        ↓
backend/routes/retrain.py pipeline:
  1. Read contributions.csv
  2. Merge with data/features.csv  (original WLASL base dataset)
  3. Train Keras MLP — 20 fast epochs on the combined data
  4. Export weight binary → frontend/public/models/alphabet/group1-shard1of1.bin
  5. Bump version.json → frontend detects change and hot-reloads the model
```

**Result:** The alphabet model running in the browser is updated live with CamSL contributions — no redeploy needed.

---

## Channel 2 — Word Signs (data stored; retraining not yet wired)

```
User performs a word sign (e.g. "hello", "thank_you", "help")
        ↓
Frontend records a 30-frame sequence
Each frame = 150 holistic features:
  [0:63]   hand landmarks  (wrist-origin, scale by landmark 9)
  [63:123] face landmarks  (nose-centred, 20 key points)
  [123:150] pose landmarks (shoulder-centred, 9 upper-body points)
        ↓
POST /api/word-contributions
        ↓
backend/data/word_signs/<sign_name>/<timestamp>.json
  shape per file: list of 30 frames × 150 floats
        ↓
        ⚠️  PIPELINE STOPS HERE
```

The JSON files accumulate on Render's disk, but nothing currently reads them to retrain `signs.onnx`. The live word-sign model is still the one trained from WLASL videos (52% test accuracy on 21 samples).

---

## The Gap — What Would Complete Channel 2

To close the loop, a background retraining job is needed:

```
backend/data/word_signs/<sign>/*.json   (N sequences, each 30 × 150)
        ↓
retrain_signs.py  (to be built):
  1. Load all .json sequences per sign
  2. Pad / trim every sequence to exactly 30 frames
  3. Stack into numpy array  (N, 30, 150)
  4. Retrain LSTM + Attention model (same architecture as train_signs.py)
  5. Convert to ONNX → models/signs.onnx
  6. Reload onnxruntime InferenceSession in backend/routes/signs.py
        ↓
New word-sign predictions immediately reflect contributed data
```

Trigger threshold suggestion: every 10 new word-sign samples (vs. 25 for alphabet, since sequences are more expensive to collect).

---

## File Map

| Path | Purpose |
|---|---|
| `backend/data/contributions.csv` | Alphabet letter contributions (63 features each) |
| `backend/data/word_signs/<sign>/*.json` | Word-sign sequences (30 frames × 150 features each) |
| `backend/routes/contributions.py` | API endpoints for both channels + auto-retrain hook |
| `backend/routes/retrain.py` | Background MLP retraining pipeline (alphabet only) |
| `data/features.csv` | Original base dataset merged during alphabet retrain |
| `models/signs.onnx` | Deployed word-sign LSTM model (WLASL-trained, 303 KB) |
| `models/signs_labels.json` | 14 recognised word-sign class names |
| `frontend/public/models/alphabet/` | Live alphabet model weights served to the browser |

---

## Valid Word Signs (Channel 2)

```
hello    thank_you   yes       no        please
help     sorry       goodbye   name      eat
drink    water       good      bad       friend
```

Defined in `backend/routes/contributions.py → VALID_SIGNS`.
