# CamSL Translator — Technical Audit Findings
*Recorded June 22, 2026. Two audit passes performed; fixes applied in three phases.*

---

## Executive Summary

The project is a credible final-year undergraduate application. The core ML pipeline (alphabet recognition) works correctly. The main risks were in three areas: academic integrity (unfair ML comparison), runtime stability (GC spikes, OOM during retraining), and code maintainability (God object). All critical and high-severity issues have been fixed. One architectural improvement (MediaPipe-to-JS) was assessed and deferred as out-of-scope for the submission window.

---

## Findings by Severity

### CRITICAL — Fixed

#### C1: Augmented MLP vs. Unaugmented RF (train.py)
- **File:** `src/train.py`, function `train_baseline()`
- **Issue:** The Keras MLP was trained on `X_train_aug` (4× augmented, ~Gaussian noise copies). The RandomForest baseline was trained on `X_train` (original, unaugmented). The old docstring *defended* this as "fair", claiming landmark noise is not meaningful for tree splits — which is backwards. A fair comparison requires identical input data; the effect of augmentation on accuracy is the result, not a precondition to manipulate.
- **Examiner risk:** Direct academic integrity challenge. An ML-literate examiner will notice the sample counts in the results file immediately.
- **Fix:** `train_baseline()` now receives `X_train_aug, y_train_aug`. Docstring rewritten. Results file now notes "applied to BOTH models".
- **Status:** FIXED

#### C2: `keras.backend.clear_session()` in retraining thread (app.py)
- **File:** `src/app.py`, `_run_retraining_thread()`
- **Issue:** Called before loading the old model to evaluate it. `clear_session()` destroys ALL Keras graphs in the process — including the live `self._recognizer` model used by the ML inference loop. After this call, the recognizer's internal TF graph is gone; subsequent predictions produce garbage or crash.
- **Severity:** Silent data corruption. The app continues to "work" but produces wrong predictions.
- **Fix:** `keras.backend.clear_session()` removed. Old model loaded directly without clearing session.
- **Status:** FIXED

---

### HIGH — Fixed

#### H1: Base64 IPC Video Streaming (app.py / index.html)
- **Files:** `src/app.py` `_capture_loop()`, `ui/index.html` `poll()` / `renderFrame()`
- **Issue:** Each webcam frame was:
  1. JPEG-encoded (OpenCV)
  2. Base64-encoded (Python) — adds 33% size overhead
  3. Written into `self._state["frame_b64"]`
  4. Serialised into a ~50 KB JSON string by `get_state()`
  5. Shipped over PyWebView's IPC bridge 30 times/second
  6. Decoded in JS and set as a `data:image/jpeg;base64,...` URL string
  7. Immediately discarded (old string GC'd)
  This caused GC pauses in the JS heap, IPC serialisation overhead, and CPU contention between the webcam thread and the IPC thread.
- **Fix:** `src/mjpeg.py` — `MjpegServer` (Python `ThreadingHTTPServer`) serves binary JPEG via `multipart/x-mixed-replace`. JS calls `get_stream_url()` once on startup and sets `<img src=url>`. Browser streams natively. `get_state()` payload drops from ~50 KB to ~1 KB.
- **Status:** FIXED

#### H2: Retraining OOM Risk (app.py)
- **File:** `src/app.py`, `_run_retraining_thread()`
- **Issue:** Background retraining loaded the full dataset + 4× augmented copies into memory while the main process held: webcam frame buffer, 3 MediaPipe models (hand + face + pose), LSTM signs model, Keras alphabet model. TF threads were unrestricted, starving the inference loops. No memory ceiling.
- **Fix:** TF thread limits set to 2 inter/intra-op. Dataset capped at 8 000 samples. Large intermediate arrays (`del` + `gc.collect()`) freed promptly after use. Old model loaded without `clear_session()`.
- **Status:** FIXED

#### H3: _ml_loop Busy-Spin (app.py)
- **File:** `src/app.py`, `_ml_loop()`
- **Issue:** ML thread ran MediaPipe + Keras inference on every iteration regardless of whether the capture thread had produced a new frame. At 30 fps capture and 15-25 fps inference, approximately half of all inference calls were redundant duplicates.
- **Fix:** `_frame_id` counter incremented by capture thread per frame. ML thread skips with 2 ms sleep when `frame_id == _ml_frame_id`.
- **Status:** FIXED

---

### MEDIUM — Fixed

#### M1: Gemini Prompt Injection Surface (app.py)
- **File:** `src/app.py`, `send_chat_message()`
- **Issue:** `message` and `history` were passed directly to the Gemini API with no length caps, type validation, or structure checks. A crafted history payload could inject system-instruction-style content.
- **Fix:** Message capped at 1 000 chars; history capped at last 20 turns × 2 000 chars; type-checked before use.
- **Status:** FIXED

#### M2: God Object — app.py (partial)
- **File:** `src/app.py`
- **Issue:** ~1 000 lines handling webcam, ML inference, SQLite, Leitner system, Gemini API, TTS, speech recognition, and retraining. SQLite queries embedded directly in JS-facing API methods.
- **Fix:** SQLite/Leitner logic extracted into `src/database.py` (`LeitnerDB` class). WAL journal mode and query index added. `app.py` holds `self._db` and delegates.
- **Remaining:** Webcam/ML thread logic is still in `app.py`. Full `camera.py` extraction is a larger refactor deferred to post-submission.
- **Status:** PARTIALLY FIXED

---

### LOW — Not Fixed (documented for Future Work)

#### L1: MediaPipe-to-JS Migration
- **Recommendation:** Run `HandLandmarker` (and holistic models) in the browser via `@mediapipe/tasks-vision` WASM, eliminating all video IPC.
- **Blockers:**
  - `alphabet.keras` requires Keras → TFLite → TF.js conversion with accuracy validation.
  - LSTM + MultiHeadAttention layer is not trivially exportable to TF.js.
  - Holistic feature normalisation must be ported to JS identically (mismatch breaks the signs model).
  - Estimated 3–5 day scope.
- **Decision:** Deferred. Document in dissertation Chapter 5 as Future Work.

#### L2: No CI/CD
- No GitHub Actions or equivalent. Tests exist but must be run manually.
- Low risk for a dissertation project; acceptable to leave.

#### L3: camera.py Extraction Not Completed
- `_capture_loop` and `_ml_loop` remain in `app.py`. The frame-skip fix makes them correct; they are just not in a separate module.
- Acceptable for submission scope.

---

## Test Coverage Added

| File | Tests | Coverage |
|---|---|---|
| `tests/test_word_builder.py` | 9 | WordBuilder commit logic, space trigger, repeat guard, autocomplete |
| `tests/test_landmarks.py` | 9 | Normalisation math, translation invariance, dtype, zero-scale safety, holistic constants |
| **Total** | **18** | **18/18 passing** |

Run: `pytest tests/ -v`

---

## New Files Created This Session

| File | Purpose |
|---|---|
| `src/mjpeg.py` | MJPEG streaming server replacing Base64 IPC |
| `src/database.py` | LeitnerDB — all SQLite/spaced-repetition logic |
| `tests/test_word_builder.py` | Unit tests for WordBuilder |
| `tests/test_landmarks.py` | Unit tests for landmark normalisation |

---

## Modified Files This Session

| File | What Changed |
|---|---|
| `src/train.py` | RF baseline now receives augmented data; docstring corrected |
| `src/app.py` | MJPEG integration; LeitnerDB delegation; frame-skip guard; retraining OOM fixes; Gemini input sanitisation |
| `ui/index.html` | `startPolling()` calls `get_stream_url()` once; `renderFrame()` → `renderFps()` |

---

## Risk Register (Post-Fix)

| Risk | Likelihood | Impact | Status |
|---|---|---|---|
| Examiner challenges ML comparison | Low | High | Mitigated (equal augmentation) |
| App OOM crash during retraining | Low | High | Mitigated (8k cap, thread limits, gc) |
| GC spikes freeze UI during use | Low | Medium | Mitigated (MJPEG stream) |
| Inference model corruption on retrain | Eliminated | Critical | Fixed (clear_session removed) |
| Signs model not available at launch | Low | Low | Graceful skip already implemented |
| MediaPipe-to-JS migration scope creep | N/A | High | Deferred — do not attempt pre-submission |
