# Architecture Ground Truth
> Verified June 26, 2026 — answers to dissertation pre-write questions.

---

## Q1: Is the desktop framing fully retired?

**Yes.** Two codebases co-exist in the repo. The submission build is the React + FastAPI version.

| Version | Path | Status |
|---|---|---|
| v1 (old) | `src/app.py` + `ui/index.html` | PyWebView desktop shell — still on disk, not the submission |
| v2 (current) | `frontend/` + `backend/` | React + TF.js + MediaPipe WASM + FastAPI — **this is the submission** |

### What to write in the abstract

Replace *"desktop application"* with **"browser-based application served by a local FastAPI server."**

The phrase *"runs on a laptop CPU"* remains accurate — MediaPipe WASM and TensorFlow.js both execute locally on the user's machine. No webcam data or landmark features are sent to the server; all inference is client-side.

### How inference actually works (v2)

- `frontend/src/hooks/useMediaPipe.ts` — `HandLandmarker` running in the browser via `@mediapipe/tasks-vision` WASM (GPU delegate, CPU fallback).
- `frontend/src/hooks/useInference.ts` — Keras MLP reconstructed as a `tf.Sequential` in TensorFlow.js; weights loaded from a binary file (`/models/alphabet/group1-shard1of1.bin`) produced by `scripts/convert_model.py`.
- The FastAPI backend handles auth, chat, practice persistence, contributions, and retraining only — it never touches webcam frames.

---

## Q2: Storage layer — is SQLite accurate?

**Yes, SQLite — but two separate databases, not one.**

| Database | Path | Contents |
|---|---|---|
| User accounts | `backend/data/users.db` | `users` table (username, PBKDF2 hash, created) + `sessions` table (bearer tokens) |
| Practice progress | `backend/data/leitner_{session_id}.db` | One file per user session; `leitner_stats` table (letter, box 1–5, next_review, attempt counts) |

Contributions are stored as CSV, not SQLite: `data/contributions/contributions.csv`.

---

## Q3: Which features are live in the submission build?

All five are confirmed live.

| Feature | Live? | Key files |
|---|---|---|
| PBKDF2 auth | **Yes** | `backend/db_users.py` — PBKDF2-HMAC-SHA256, 260,000 iterations, Python stdlib only (no third-party crypto) |
| Three.js 3D hand model | **Yes** | `frontend/src/components/Hand3D.tsx` |
| Leitner practice mode | **Yes** | `backend/db.py` + `backend/routes/practice.py` |
| Dataset contribution + background retraining | **Yes** | `frontend/src/components/DatasetPanel.tsx` + `backend/routes/contributions.py` + `backend/routes/retrain.py` |
| Gemini AI chat | **Yes** | `frontend/src/components/ChatPanel.tsx` + `backend/routes/chat.py` |

### Auth detail (for Methods section)

- Passwords: PBKDF2-HMAC-SHA256, 260,000 iterations, 16-byte random salt, stored as `salt:hash`.
- Sessions: 32-byte cryptographically random hex token, stored in `sessions` table.
- One active session per user (old sessions deleted on new login).
- Token passed as `Authorization: Bearer <token>` header from the React frontend.

---

## Q4: Model parameter count — verified

Run on the saved `models/alphabet.keras` via `model.summary()`:

```
Layer                    Output Shape    Params
─────────────────────────────────────────────────
Dense(256, relu)         (None, 256)     16,384
BatchNormalization        (None, 256)      1,024
Dropout(0.3)             (None, 256)          0
Dense(128, relu)         (None, 128)     32,896
BatchNormalization        (None, 128)        512
Dropout(0.3)             (None, 128)          0
Dense(64, relu)          (None, 64)       8,256
BatchNormalization        (None, 64)         256
Dropout(0.3)             (None, 64)           0
Dense(24, softmax)       (None, 24)       1,560
─────────────────────────────────────────────────
Trainable params:        59,992
Non-trainable params:       896   ← BN moving mean/variance
─────────────────────────────────────────────────
Total model params:      60,888
```

**Use 60,888 in the dissertation.** Do not cite the 180,874 figure that Keras 3.x prints as "Total params" — that includes Adam optimizer state (119,986 = 2× trainable weights for first/second moment estimates), which is not part of the model.

The ~107,000 figure that was previously unresolved was incorrect. 60,888 has now been verified directly from the saved model file.

### Why 60,888 matches the TF.js weight file

`useInference.ts` lists every weight tensor in binary order. Summing their sizes:

| Tensor | Size |
|---|---|
| Dense256 kernel [63,256] | 16,128 |
| Dense256 bias [256] | 256 |
| BN256 gamma, beta, mean, var [256 each] | 1,024 |
| Dense128 kernel [256,128] | 32,768 |
| Dense128 bias [128] | 128 |
| BN128 gamma, beta, mean, var [128 each] | 512 |
| Dense64 kernel [128,64] | 8,192 |
| Dense64 bias [64] | 64 |
| BN64 gamma, beta, mean, var [64 each] | 256 |
| Dense24 kernel [64,24] | 1,536 |
| Dense24 bias [24] | 24 |
| **Total floats** | **60,888** |

---

## Summary for dissertation chapters

| Section | Correct statement |
|---|---|
| Abstract | "browser-based application with a local FastAPI backend; all ML inference runs client-side via TensorFlow.js and MediaPipe WebAssembly" |
| Architecture figure | Two SQLite databases (users.db + per-session leitner DB); React frontend; FastAPI backend |
| Model parameters | 60,888 total (59,992 trainable + 896 non-trainable BatchNorm statistics) |
| Auth | PBKDF2-HMAC-SHA256, 260,000 iterations |
| Inference | Client-side WASM + TF.js; server never receives video or landmark data |
