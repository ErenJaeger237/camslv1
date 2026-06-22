# CAMSL Translator — Complete Technical Findings
> **Analysed by:** Antigravity AI · **Date:** 2026-06-18  
> **Project path:** `c:\Users\NTS\Documents\cameroun_s_t\camsl-translator\`  
> **Purpose of this document:** A complete reproduction guide — architecture, data pipeline, ML model, AI avatar, runtime design, and every tunable constant.

---

## 1. Project Overview

**What it is:** A real-time, bidirectional, offline-capable desktop application that bridges communication between deaf and hearing people using the American Sign Language (ASL) manual alphabet, adapted for a Cameroon context (CamSL).

**Framing:** Final-year undergraduate dissertation project. Clarity and reliability over cleverness. Targets an ordinary laptop with a webcam — **no GPU required**.

**Two core directions:**

| Direction | How it works |
|---|---|
| **Sign → Text** | Webcam → MediaPipe → 63 landmark features → Keras MLP → letter prediction → word builder → autocomplete → TTS |
| **Text / Speech → Sign** | Typed text (or mic) → sign image lookup → display image sequence per letter/word |

**Scope deliberately limited to:**
- 24 static handshapes (A–Y, **excluding J and Z** which require motion)
- A vocabulary of ~23 common whole-word signs (HELLO, GOODBYE, etc.)
- Fingerspelling of any English word letter by letter

---

## 2. Repository Structure (Fully Annotated)

```
cameroun_s_t/
├── claude.md                    ← Project memory/spec for AI assistants
└── camsl-translator/
    ├── requirements.txt         ← All Python dependencies
    ├── .gitignore
    │
    ├── data/
    │   ├── features.csv         ← 63-feature landmark CSV (~70 MB, ~57k rows)
    │   ├── raw/                 ← Empty; populated by extract_landmarks.py via kagglehub
    │   └── contributions/       ← Empty; populated at runtime by Dataset Builder mode
    │
    ├── assets/
    │   └── signs/               ← 24 PNG images (A-Y excl. J,Z) for Text→Sign display
    │       ├── A.png … Y.png
    │
    ├── models/
    │   ├── alphabet.keras       ← Trained Keras MLP (~760 KB, 60,888 params)
    │   └── hand_landmarker.task ← MediaPipe hand detection model (~7.8 MB, Google)
    │
    ├── outputs/
    │   ├── confusion_matrix.png ← 24×24 normalised heatmap (seaborn)
    │   ├── accuracy_curves.png  ← Train/val accuracy & loss curves (matplotlib)
    │   ├── metrics.txt          ← Quick summary (99.03% test accuracy)
    │   └── results.txt          ← Full dissertation-ready results table
    │
    ├── ui/
    │   ├── index.html           ← Single-file frontend (HTML + CSS + JS + Three.js)
    │   └── poses.json           ← Cached canonical 3D hand poses per letter
    │
    └── src/
        ├── extract_landmarks.py ← [Step 1] Dataset → features.csv
        ├── add_dataset.py       ← [Step 1b] Append synthetic ASL dataset
        ├── augment_images.py    ← [Step 1c] Image-level augmentation → append CSV
        ├── copy_sign_images.py  ← [Utility] Pick best dataset image per letter → assets/signs/
        ├── train.py             ← [Step 2] Train Keras MLP + RF baseline → save model
        ├── landmarks.py         ← [Runtime] MediaPipe VIDEO-mode wrapper
        ├── recognizer.py        ← [Runtime] Load .keras model, predict letter
        ├── word_builder.py      ← [Runtime] Stability-based letter commit logic
        ├── autocomplete.py      ← [Runtime] Prefix-based English word suggestions
        ├── tts.py               ← [Runtime] Text-to-speech via Windows PowerShell
        ├── text_to_sign.py      ← [Runtime] Map text → sign image paths
        ├── speech_to_sign.py    ← [Runtime] Mic → Google STT → text_to_sign
        └── app.py               ← [Entry point] pywebview shell + CamSLAPI class
```

---

## 3. System Architecture

### 3.1 High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CAMSL TRANSLATOR                            │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                   pywebview Window (Edge WebView2)           │  │
│  │   ┌──────────────────────────────────────────────────────┐   │  │
│  │   │              ui/index.html  (JS Frontend)            │   │  │
│  │   │                                                      │   │  │
│  │   │  ┌────────────┐ ┌───────────────┐ ┌──────────────┐  │   │  │
│  │   │  │ Sign→Text  │ │ Text→Sign     │ │  Practice    │  │   │  │
│  │   │  │  Panel     │ │  Panel        │ │  Panel       │  │   │  │
│  │   │  │            │ │               │ │  + Three.js  │  │   │  │
│  │   │  │ poll@30fps │ │ sign images   │ │  3D avatar   │  │   │  │
│  │   │  └─────┬──────┘ └──────┬────────┘ └──────┬───────┘  │   │  │
│  │   └────────┼───────────────┼─────────────────┼──────────┘   │  │
│  │            │  JS bridge (window.pywebview.api)│              │  │
│  └────────────┼───────────────┼─────────────────┼──────────────┘  │
│               ▼               ▼                  ▼                 │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    CamSLAPI (Python)                        │   │
│  │                                                             │   │
│  │  get_state()  get_signs_for_text()  start_listening()       │   │
│  │  speak()  clear_text()  backspace()  accept_suggestion()    │   │
│  │  save_contribution()  get_canonical_poses()                 │   │
│  │  get_practice_initial()  next_practice_letter()             │   │
│  │                                                             │   │
│  │   ┌──────────────┐          ┌──────────────────────────┐   │   │
│  │   │ Thread 1     │          │ Thread 2                 │   │   │
│  │   │ _capture_loop│  frame   │ _ml_loop                 │   │   │
│  │   │              │ ──────►  │                          │   │   │
│  │   │ cv2.VideoCapture        │ LandmarkExtractor        │   │   │
│  │   │ flip + resize           │   .process(frame)        │   │   │
│  │   │ skeleton overlay        │     → 63 features        │   │   │
│  │   │ JPEG-encode             │ Recognizer.predict()     │   │   │
│  │   │ → base64                │   → letter, confidence   │   │   │
│  │   │ → _state["frame_b64"]  │ WordBuilder.update()     │   │   │
│  │   └──────────────┘          │   → commit letter        │   │   │
│  │                             └──────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Class Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  app.py                                                          │
│                                                                  │
│  CamSLAPI                                                        │
│  ─────────────────────────────────────────────────────           │
│  - _extractor  : LandmarkExtractor                               │
│  - _recognizer : Recognizer                                      │
│  - _builder    : WordBuilder                                     │
│  - _tts        : TTS                                             │
│  - _mode       : str  ("sign2text" | "text2sign" | "practice")  │
│  - _state      : dict  (shared state read by JS every 33ms)     │
│  - _lock       : threading.Lock  (protects _state)              │
│  - _frame_lock : threading.Lock  (protects _raw_frame/_raw_lm)  │
│  - _raw_frame  : np.ndarray | None                              │
│  - _raw_lm     : list | None                                    │
│  - _last_features : np.ndarray | None                           │
│  - _canonical_poses : dict  {letter: [[x,y,z]×21]}             │
│  - _practice_letter : str                                        │
│  - _p_correct, _p_total, _p_streak : int                        │
│  ─────────────────────────────────────────────────────           │
│  + get_state() → dict                                           │
│  + set_mode(mode: str)                                          │
│  + speak()                                                      │
│  + clear_text()                                                 │
│  + backspace()                                                  │
│  + accept_suggestion(word: str)                                 │
│  + get_signs_for_text(text: str) → list[{char, b64}]           │
│  + start_listening() → {text} | {error}                         │
│  + save_contribution(label: str) → {success} | {error}          │
│  + get_canonical_poses() → dict                                 │
│  + get_practice_initial() → dict                                │
│  + record_practice_result(correct: bool) → dict                 │
│  + next_practice_letter() → dict                                │
│  + shutdown()                                                   │
│  - _capture_loop()   [Thread 1 — Display]                       │
│  - _ml_loop()        [Thread 2 — Inference]                     │
│  - _load_canonical_poses() → dict                               │
│  - _push_builder_state()                                        │
│  - _practice_dict() → dict                                      │
└────────────────┬───────────────────────────────────────────────┘
                 │ uses
    ┌────────────┼────────────┬──────────────┬────────────────────┐
    ▼            ▼            ▼              ▼                    ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐
│Landmark  │ │Recognizer│ │WordBuil- │ │  TTS     │ │  autocomplete  │
│Extractor │ │          │ │der       │ │          │ │  .suggest()    │
│──────────│ │──────────│ │──────────│ │──────────│ │────────────────│
│MediaPipe │ │tf.keras  │ │deque     │ │PowerShell│ │word list       │
│VIDEO mode│ │MLP model │ │buffer    │ │SAPI5     │ │prefix filter   │
│21 lms    │ │24 classes│ │stability │ │          │ │max 5 results   │
│normalise │ │0.80 conf │ │frames=15 │ │rate=1    │ │min prefix=2    │
│open palm │ │threshold │ │space=20  │ │vol=90    │ │                │
└──────────┘ └──────────┘ └──────────┘ └──────────┘ └────────────────┘
```

---

## 4. The ML Pipeline — End to End

### 4.1 Step 1 — Data Acquisition (`extract_landmarks.py`)

**Input:** ASL Alphabet image dataset from Kaggle (`grassknoted/asl-alphabet`)  
**Auto-download:** `kagglehub.dataset_download("grassknoted/asl-alphabet")` — cached in `~/.cache/kagglehub/`

**Process (per image):**
1. Load image with OpenCV (`cv2.imread`)
2. Convert BGR → RGB
3. Run **MediaPipe HandLandmarker** in `IMAGE` mode (stateless, confidence threshold = 0.3)
4. If a hand is detected → extract 21 landmarks × (x, y, z) = 63 raw values
5. **Normalise** (critical — must be identical in inference):
   - Translate: subtract wrist (landmark 0) coordinates → wrist becomes `(0, 0, 0)`
   - Scale: divide all coords by `‖landmark_9‖` (wrist-to-middle-finger-MCP distance)
   - Result: pose-invariant, size-invariant 63-dimensional vector
6. Append row `[f0, f1, …, f62, LABEL]` to `data/features.csv`

**Labels:** 24 uppercase letters (`ABCDEFGHIKLMNOPQRSTUVWXY`). J and Z excluded permanently.

**Output CSV columns:** `feature_0` … `feature_62`, `label`

---

### 4.2 Step 1b — Add Synthetic Dataset (`add_dataset.py`)

Downloads `lexset/synthetic-asl-alphabet` from Kaggle (diverse skin tones, backgrounds, lighting).  
Appends extracted landmarks to the **same** `features.csv` (non-destructive `"a"` mode append).

**Label remap:** Handles lowercase folder names and uppercase pass-through.

---

### 4.3 Step 1c — Image Augmentation (`augment_images.py`)

Reads the *original* Kaggle images (not from CSV), applies random transforms **before** MediaPipe, then appends to CSV. This is more powerful than feature-level noise because it changes what MediaPipe actually sees.

**Transforms applied per image (3 copies each):**

| Transform | Range |
|---|---|
| Brightness | ×0.55 – ×1.45 |
| Contrast | scale 0.65 – 1.35 around mean |
| Rotation | –18° to +18° |
| Zoom | 0.80 – 1.20 (crop+resize or pad) |
| Gaussian Blur | 35% probability, kernel 3×3 or 5×5 |

---

### 4.4 Step 2 — Training (`train.py`)

#### Data Split

```
Full dataset
    │
    ├──[85%]──► train+val set
    │               │
    │               ├──[70% of full]──► X_train  (then augmented ×4)
    │               └──[15% of full]──► X_val    (EarlyStopping monitor)
    │
    └──[15%]──► X_test  (touched ONCE at the very end)
```

#### Augmentation at Training Time

In addition to image augmentation, Gaussian feature-level noise is added:
- **3 noisy copies** per training sample
- Noise std = **0.015** (in normalised landmark units)
- Training set grows ×4 after augmentation

#### Keras MLP Architecture

```
Input:  (63,)
   │
   ▼  Dense(256, relu)
      BatchNormalization
      Dropout(0.3)
   │
   ▼  Dense(128, relu)
      BatchNormalization
      Dropout(0.3)
   │
   ▼  Dense(64, relu)
      BatchNormalization
      Dropout(0.3)
   │
   ▼  Dense(24, softmax)

Output: probability distribution over 24 letters
Total trainable params: 60,888
Model file size: ~760 KB
```

#### Training Configuration

| Hyperparameter | Value |
|---|---|
| Optimizer | Adam |
| Learning rate | 0.001 |
| Loss | Sparse Categorical Crossentropy |
| Max epochs | 50 |
| Batch size | 64 |
| EarlyStopping patience | 8 (monitors `val_accuracy`) |
| ReduceLROnPlateau | factor=0.5, patience=4 (monitors `val_loss`) |

#### Baseline Comparison

A **RandomForest (200 trees, n_jobs=-1)** is trained on the raw (unaugmented) training split for a fair apples-to-apples comparison.

---

### 4.5 Model Performance (from `outputs/results.txt` and `outputs/metrics.txt`)

| Metric | Keras MLP | RandomForest |
|---|---|---|
| **Test Accuracy** | **98.96%** | 98.41% |
| Improvement | +0.55 pp | — |
| Inference latency | **0.756 ms/sample** | — |
| Implied FPS | **1,322 FPS** | — |
| Model size | **760 KB** | — |
| Total test samples | 8,662 | — |
| Training time | 734.6 s | — |
| Epochs run | 50 / 50 | — |

**Per-class worst performers** (hardest to distinguish):
- **M** (F1: 0.96/0.97) — fingers over thumb, visually similar to N
- **N** (F1: 0.95/0.96) — subset of M's gesture

All other letters score F1 ≥ 0.98.

---

## 5. Real-Time Inference Architecture

### 5.1 Dual-Thread Design

The key architectural decision is to **separate display from inference** using two daemon threads:

```
Thread 1 — _capture_loop()             Thread 2 — _ml_loop()
─────────────────────────────────       ───────────────────────────────
cv2.VideoCapture(0) @ 640×480          Reads _raw_frame (no-sleep loop)
flip horizontally                       ↓
copy to _raw_frame ──────────────────► resize to 320×240 (MediaPipe input)
read _raw_lm (from ML thread)          LandmarkExtractor.process()
draw skeleton overlay                      → 63 features OR None
resize to 540×405                          → is_open_palm: bool
JPEG encode Q=75                           → raw_lm: list of 21 points
base64 encode                          writes _raw_lm back (for Thread 1)
→ _state["frame_b64"]                  Recognizer.predict(features)
sleep(1/30 - elapsed)                     → letter, confidence
                                       WordBuilder.update(letter, conf)
Target: 30 FPS display                    → commit letter/space
                                       → _state update (with lock)
                                       No sleep — runs as fast as CPU
```

**Why two threads?**  
MediaPipe runs at ~15–25 fps on a mid-range CPU. If it ran in the display thread, the webcam would stutter. Separating them lets display stay fluid at 30+ fps while inference runs at whatever speed the CPU allows.

**Shared state protection:**
- `_lock` — protects the `_state` dict (JS polls this every 33ms)
- `_frame_lock` — protects `_raw_frame`, `_raw_lm`, `_last_features` (written by both threads)

### 5.2 The Shared `_state` Dict

This is the single source of truth that JS reads on every poll:

```python
_state = {
    "frame_b64":    "",        # JPEG-encoded webcam frame as base64 string
    "letter":       None,      # predicted letter string or None
    "confidence":   0.0,       # float 0–1, softmax top probability
    "open_palm":    False,     # True when all fingers extended (SPACE trigger)
    "has_hand":     False,     # True if MediaPipe detected a hand
    "fps":          0.0,       # display thread FPS
    "status":       "Starting...",
    "error":        False,
    "stability":    0.0,       # fraction 0–1 (how full the commit buffer is)
    "current_word": "",        # letters signed since last SPACE
    "current_text": "",        # completed words (with trailing spaces)
    "suggestions":  [],        # list of autocomplete suggestions
}
```

---

## 6. Module-Level Deep Dive

### 6.1 `landmarks.py` — MediaPipe Wrapper

**Class:** `LandmarkExtractor`

**Key design choices:**
- Uses `RunningMode.VIDEO` (not IMAGE) — MediaPipe tracks the hand between frames for smoother, faster results
- Input to MediaPipe: **320×240** downscale (faster inference; normalised coords don't lose accuracy)
- Timestamps: `time.perf_counter()` in milliseconds, monotonically increasing (VIDEO mode requirement)

**Normalisation (must match `extract_landmarks.py` exactly):**
```python
coords = [[lm.x, lm.y, lm.z] for lm in landmarks]  # shape (21, 3)
coords -= coords[0]                                    # wrist → origin
scale = np.linalg.norm(coords[9])                     # wrist-to-MCP9 distance
if scale > 0: coords /= scale
return coords.flatten()  # shape (63,), float32
```

**Open palm detection:**  
All 4 fingertips (8, 12, 16, 20) have y < their PIP joints (6, 10, 14, 18) **AND** thumb tip (4) y < thumb IP (3). Because MediaPipe's y-axis runs top-to-bottom in image space, "y less than PIP" means the tip is above the PIP = finger is extended.

**Tunable constants:**
```python
min_hand_detection_confidence = 0.5
min_hand_presence_confidence  = 0.5
min_tracking_confidence       = 0.5
MP_W, MP_H = 320, 240  # inference resolution
```

---

### 6.2 `recognizer.py` — Keras Predictor

**Class:** `Recognizer`

```python
ALPHABET_LABELS = sorted("ABCDEFGHIKLMNOPQRSTUVWXY")  # 24 labels, lexicographic
CONFIDENCE_THRESHOLD = 0.80  # below this → returns (None, confidence)
```

**Predict flow:**
```python
probs = model.predict(features[np.newaxis], verbose=0)[0]  # shape (24,)
idx   = np.argmax(probs)
confidence = probs[idx]
if confidence < 0.80: return None, confidence
return ALPHABET_LABELS[idx], confidence
```

> **Critical note:** Labels must be sorted **lexicographically** (sklearn's `LabelEncoder` does this during training). The label order here and in `train.py` must be identical.

---

### 6.3 `word_builder.py` — Stability-Based Letter Commit

**Class:** `WordBuilder`

**The commit algorithm:**

```
Every frame:
  if letter is None:
    _buffer.clear()
    _no_hand_count += 1
    if _no_hand_count >= SPACE_FRAMES (20):
      commit SPACE
      reset _last_committed
  else:
    _no_hand_count = 0
    _buffer.append(letter)       # rolling deque(maxlen=15)
    if len(buffer) == 15 AND all same AND letter != _last_committed:
      commit letter
      _last_committed = letter
      _buffer.clear()
```

**Guards against:**
1. Accidental repeats (same letter can't commit twice in a row)
2. Noisy frames (needs 15 identical frames ≈ 0.5s at 30fps)
3. Hand still in frame (open palm or no-hand for 20 frames = SPACE)

**State:**
- `current_word` — letters since last SPACE (building)
- `current_text` — completed words with trailing spaces

**Tunable constants:**
```python
STABILITY_FRAMES = 15  # frames to commit a letter (~0.5 s at 30 fps)
SPACE_FRAMES     = 20  # consecutive no-hand frames to commit a SPACE
```

---

### 6.4 `autocomplete.py` — Word Suggestions

**Function:** `suggest(prefix, max_results=5) → list[str]`

- Prefix-match against a hardcoded 100+ word list (curated for communication contexts)
- Returns empty list if prefix < 2 chars
- All words stored uppercase; results returned uppercase

**Word categories:** Greetings, politeness, yes/no, family, basic needs, health, places, time, descriptors, actions, learning vocabulary.

**Constants:**
```python
MAX_SUGGESTIONS = 5
MIN_PREFIX_LEN  = 2
```

---

### 6.5 `tts.py` — Text-to-Speech

**Class:** `TTS`

**Why not pyttsx3?** pyttsx3/SAPI5 has a known Windows bug where the engine silently stops after the first `runAndWait()` call. This implementation spawns a **fresh PowerShell process** per utterance using `System.Speech.Synthesis.SpeechSynthesizer`.

**PowerShell script (simplified):**
```powershell
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$eng = $synth.GetInstalledVoices() | Where { $_.VoiceInfo.Culture.Name -like 'en*' } | Select -First 1
if ($eng) { $synth.SelectVoice($eng.VoiceInfo.Name) }
$synth.Rate = 1
$synth.Volume = 90
$synth.Speak('TEXT_HERE')
```

**Non-blocking:** `speak()` fires a daemon thread; the process handle is stored to allow `stop()` to `terminate()` mid-speech.

**Constants:**
```python
SPEECH_RATE   = 1    # -10 to 10, 0 = normal
SPEECH_VOLUME = 90   # 0–100
```

---

### 6.6 `text_to_sign.py` — Text → Sign Image Lookup

**Function:** `text_to_image_paths(text) → list[Path]`

**Algorithm:**
1. Split text into words (uppercase)
2. For each word: check if it's in `WHOLE_WORD_SIGNS` AND the image exists → use whole-word image
3. Otherwise: spell letter by letter, look up `assets/signs/X.png` for each char
4. Skip non-alpha chars and missing images silently

**Whole-word vocabulary (23 words):**
```
HELLO, GOODBYE, THANKYOU, THANK, YES, NO, PLEASE, HELP, SORRY,
NAME, EAT, DRINK, WATER, GOOD, BAD, SICK, HOSPITAL, SCHOOL,
FRIEND, OKAY, MORE, STOP
```

---

### 6.7 `speech_to_sign.py` — Speech → Sign Pipeline

**Class:** `SpeechToSign`

**Flow:**
```
Microphone
   ↓ adjust_for_ambient_noise (0.5 s calibration)
   ↓ listen (max 10 s phrase)
   ↓ recognize_google(audio)   ← Google free STT API
   ↓ text_to_image_paths(text)
   ↓ on_result(text, paths)    ← callback
```

All runs in a daemon thread; `is_listening` flag prevents concurrent calls.

> **Note:** `app.py` uses the **Web Speech API** in the JS frontend instead (native Edge/WebView2 speech recognition), not this Python class. The `speech_to_sign.py` module is available standalone but the main app delegates to browser-native STT.

---

## 7. The pywebview Bridge (Python ↔ JavaScript)

### 7.1 How It Works

```
Python:  webview.create_window(url="ui/index.html", js_api=CamSLAPI_instance)
                                                          ↓
JS:      window.pywebview.api.method_name(args)
                                → returns Promise<ReturnValue>
```

All public methods of `CamSLAPI` are automatically exposed. Return values (dicts/lists) are JSON-serialised by pywebview.

### 7.2 JS Bridge API Reference

| JS Call | Python Method | Returns | Called by |
|---|---|---|---|
| `api.get_state()` | `get_state()` | `dict` (full shared state) | Poll loop every 33ms |
| `api.set_mode(m)` | `set_mode(mode)` | — | Mode tab buttons |
| `api.speak()` | `speak()` | — | Speak button |
| `api.clear_text()` | `clear_text()` | — | Clear button / Esc |
| `api.backspace()` | `backspace()` | — | Backspace button |
| `api.accept_suggestion(w)` | `accept_suggestion(word)` | — | Chip click |
| `api.get_signs_for_text(t)` | `get_signs_for_text(text)` | `[{char, b64}]` | Show Signs button |
| `api.start_listening()` | `start_listening()` | `{text}` or `{error}` | (fallback; not used in main path) |
| `api.save_contribution(l)` | `save_contribution(label)` | `{success, label}` or `{error}` | Dataset builder mode |
| `api.get_canonical_poses()` | `get_canonical_poses()` | `{letter: [[x,y,z]×21]}` | Init on `pywebviewready` |
| `api.get_practice_initial()` | `get_practice_initial()` | `{letter, ref_b64, correct, total, streak}` | Init on `pywebviewready` |
| `api.record_practice_result(ok)` | `record_practice_result(correct)` | `{correct, total, streak}` | On correct/skip |
| `api.next_practice_letter()` | `next_practice_letter()` | `{letter, ref_b64, ...}` | After cooldown |

### 7.3 Polling Architecture

```javascript
// Fires every 33ms (≈30 fps)
async function poll() {
  const s = await window.pywebview.api.get_state();
  renderFrame(s);          // update <img> src with base64 JPEG
  renderPredCard(s);       // letter, confidence bar, stability bar
  if (sign2text) renderSign2Text(s);  // staging word, text, suggestions
  if (practice)  renderPractice(s);   // check if predicted letter == target
  renderStatus(s);
  setTimeout(poll, 33);
}
```

The webcam frame is delivered as a **base64 JPEG string** inside the state dict, set as the `src` of an `<img>` element. There is no WebSocket or video stream — just polling with embedded frame data.

---

## 8. The 3D Hand Avatar (Three.js)

This is the "AI Avatar" in the Practice panel — a **real-time rotating 3D hand model** that shows the canonical pose for each letter.

### 8.1 Data Source

When the app starts (`pywebviewready` event):
```javascript
canonicalPoses = await window.pywebview.api.get_canonical_poses()
// Returns { "A": [[x,y,z]×21], "B": [...], ... }
```

**Python side (`_load_canonical_poses`):**
1. Checks for cached `ui/poses.json` → returns immediately if found
2. Otherwise: loads `data/features.csv`, groups by label, computes the **mean landmark coordinates** for each letter across all training samples
3. Reshapes to `(21, 3)` and saves to `poses.json` for future runs

So the 3D pose is the **average hand shape** for each letter across the entire dataset.

### 8.2 Three.js Renderer

**Scene setup:**
- WebGL renderer on `<canvas id="handCanvas">` (200px tall, full panel width)
- Camera: `PerspectiveCamera(fov=48)` at position `(0, 0.4, 4.2)`, looking at origin
- Ambient light: white 0.65 intensity
- Directional light 1: blue (`#60a5fa`, accent colour) — 1.1 intensity
- Directional light 2: purple (`#a78bfa`, fill) — 0.4 intensity

**Animation loop:**
```javascript
handGroup.rotation.y += 0.010;  // slow auto-rotation to show 3D depth
```

**Hand geometry (`renderHandPose`):**

```
For each of 21 landmarks:
  ● Sphere (radius 0.07 for fingertips, 0.045 for joints)
    - Fingertips [4,8,12,16,20]: cyan (#00d4ff)
    - Other joints: blue accent (#3b82f6)

For each of 23 bone connections:
  ● CylinderGeometry(r=0.02, length=distance between landmarks)
    - Green (#22c55e)
    - Oriented using quaternion from (0,1,0) → bone direction vector
```

**Coordinate mapping from MediaPipe to Three.js:**
```javascript
const toV = ([x, y, z]) => new THREE.Vector3(x, -y, z * 0.4);
// y is negated because MediaPipe y goes down, Three.js y goes up
// z is compressed by 0.4 to keep the hand from looking too deep
```

**Bone topology (23 connections matching MediaPipe):**
```
Thumb:  0-1-2-3-4
Index:  0-5-6-7-8
Middle: 0-9-10-11-12
Ring:   0-13-14-15-16
Pinky:  0-17-18-19-20
Palm braces: 5-9, 9-13, 13-17
```

**Memory management:** Before rendering a new letter, all previous geometry is explicitly `dispose()`d to prevent GPU memory leaks.

---

## 9. Frontend UI Design System

### 9.1 Design Tokens (CSS Variables)

```css
--bg:           #07090f   /* deep dark navy background */
--surface:      #0d1420   /* header/footer/panels */
--card:         #111927   /* card backgrounds */
--card2:        #162033   /* hover card background */
--border:       #1c2d4a   /* default borders */
--border2:      #243a5e   /* hover borders */
--accent:       #3b82f6   /* primary blue (Tailwind blue-500) */
--accent-dim:   #1d4ed8   /* hover blue */
--accent-glow:  rgba(59,130,246,.2)
--purple:       #8b5cf6   /* stability bar, gradient */
--green:        #22c55e   /* success, high confidence */
--red:          #ef4444   /* error, danger */
--yellow:       #f59e0b   /* open palm, hints */
--text:         #e2e8f0
--text-muted:   #94a3b8
--text-dim:     #4b6080
```

### 9.2 Layout

```
┌──────────────────────────────────────────────────────────────┐
│ HEADER (52px) — brand · live indicator · mode tabs           │
├────────────────────┬─────────────────────────────────────────┤
│ LEFT PANEL (390px) │ RIGHT PANEL (flex:1)                    │
│                    │                                         │
│ • Live video feed  │ [Sign→Text] staging word · text ·       │
│   (540×405 JPEG)   │  suggestions · Speak/Backspace/Clear    │
│   skeleton overlay │                                         │
│                    │ [Text→Sign] input · sign image ·        │
│ • Prediction card  │  nav buttons · Play All                 │
│   - big letter     │                                         │
│   - conf % bar     │ [Practice] 3D hand model · prompt ·    │
│   - stability bar  │  score/streak · hint bar                │
│                    │                                         │
├────────────────────┴─────────────────────────────────────────┤
│ FOOTER (27px) — status · "ASL Alphabet · 24 signs"           │
└──────────────────────────────────────────────────────────────┘
```

### 9.3 Practice Mode Sign Tips

A `SIGN_TIPS` dictionary in JS provides human-readable instructions for every letter (A–Y). Displayed after 6 seconds if the user hasn't signed correctly. The hint progress bar fills linearly over 6 seconds.

---

## 10. Dataset Builder Feature

The app has a hidden **Dataset Builder** capability (saved as `data/contributions/contributions.csv`):

```python
def save_contribution(self, label: str):
    # Grabs _last_features (the most recent 63-dim vector from the ML thread)
    # Appends [f0, f1, …, f62, LABEL] to contributions CSV
    # This is the mechanism for collecting real CamSL data in-app
```

This is intended to grow a real Cameroon Sign Language corpus over time, letting users contribute their own hand shape data.

---

## 11. Dependency Map

```
requirements.txt
│
├── tensorflow >= 2.15.0    ← Keras MLP training + inference
├── mediapipe >= 0.10.9     ← Hand landmark detection (Tasks API)
│                              + hand_landmarker.task model (auto-downloaded)
├── opencv-python >= 4.9.0  ← Webcam capture, image processing, augmentation
├── scikit-learn >= 1.4.0   ← train/test split, LabelEncoder, RandomForest baseline
│
├── numpy >= 1.26.0         ← Feature arrays, normalisation, augmentation noise
├── pandas >= 2.2.0         ← CSV loading in train.py and canonical pose computation
├── matplotlib >= 3.8.0     ← Training curves, confusion matrix
├── seaborn >= 0.13.0       ← Confusion matrix heatmap
│
├── pywebview >= 4.4        ← Desktop window (Edge WebView2 on Windows)
│                              Exposes Python API to JavaScript
├── pyttsx3 >= 2.90         ← Listed but NOT used (see tts.py for why)
│
├── Pillow >= 10.2.0        ← Image handling utilities
├── kagglehub >= 0.2.0      ← Auto-download ASL datasets from Kaggle
├── SpeechRecognition >= 3.10.0  ← Google STT (used in speech_to_sign.py)
└── pyaudio >= 0.2.14       ← Microphone access for SpeechRecognition
```

**External CDN dependency (UI only):**
- **Three.js r134** — loaded from cdnjs for the 3D hand renderer

**Windows-only dependencies:**
- `tts.py` uses `powershell` + `System.Speech.Synthesis.SpeechSynthesizer`
- `doListen()` in JS uses `window.webkitSpeechRecognition` (Edge WebView2 native)

---

## 12. Step-by-Step Reproduction Guide

### Prerequisites

- Windows 10/11 (for TTS and WebView2)
- Python 3.11+
- Webcam
- Kaggle account + `~/.kaggle/kaggle.json` credentials file
- ~10 GB disk space for datasets + virtual env

### Install

```bash
cd camsl-translator
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### Build the Dataset

```bash
# Step 1: Download grassknoted/asl-alphabet, extract landmarks → features.csv
python src/extract_landmarks.py

# Step 1b (optional): Add synthetic dataset for diversity
python src/add_dataset.py

# Step 1c (optional): Image-level augmentation (takes a long time)
python src/augment_images.py
```

### Prepare Sign Images for Text→Sign

```bash
# Picks the best MediaPipe-confirmed image per letter → assets/signs/
python src/copy_sign_images.py
```

### Train the Model

```bash
python src/train.py
# Outputs:
#   models/alphabet.keras
#   outputs/confusion_matrix.png
#   outputs/accuracy_curves.png
#   outputs/results.txt
```

### Run the Application

```bash
python src/app.py
```

---

## 13. Tunable Constants (Master Reference)

| Constant | File | Default | Effect |
|---|---|---|---|
| `STABILITY_FRAMES` | word_builder.py | 15 | Frames to commit a letter (~0.5s@30fps) |
| `SPACE_FRAMES` | word_builder.py | 20 | No-hand frames before SPACE |
| `CONFIDENCE_THRESHOLD` | recognizer.py | 0.80 | Predictions below this discarded |
| `MAX_SUGGESTIONS` | autocomplete.py | 5 | Max autocomplete chips shown |
| `MIN_PREFIX_LEN` | autocomplete.py | 2 | Min chars before suggestions appear |
| `SPEECH_RATE` | tts.py | 1 | PowerShell synth rate (-10 to 10) |
| `SPEECH_VOLUME` | tts.py | 90 | TTS volume (0–100) |
| `WEBCAM_INDEX` | app.py | 0 | Camera device index |
| `FRAME_W / FRAME_H` | app.py | 540 / 405 | JPEG frame size sent to JS |
| `JPEG_QUALITY` | app.py | 75 | Webcam JPEG compression |
| `FPS_TARGET` | app.py | 30 | Display thread target FPS |
| `MP_W / MP_H` | landmarks.py | 320 / 240 | MediaPipe inference resolution |
| `HIDDEN_UNITS` | train.py | [256,128,64] | MLP layer widths |
| `DROPOUT_RATE` | train.py | 0.3 | Dropout regularisation |
| `EPOCHS` | train.py | 50 | Max training epochs |
| `BATCH_SIZE` | train.py | 64 | Training batch size |
| `LEARNING_RATE` | train.py | 0.001 | Adam LR |
| `EARLY_STOP_PATIENCE` | train.py | 8 | Epochs before early stop |
| `AUGMENT_COPIES` | train.py | 3 | Noisy copies per sample |
| `AUGMENT_NOISE` | train.py | 0.015 | Feature noise std-dev |
| `AUG_PER_IMAGE` | augment_images.py | 3 | Image-level aug copies |
| `HINT_DELAY` | index.html | 6000ms | Ms before practice hint shows |

---

## 14. Known Limitations & Future Work

### Current Limitations

| Limitation | Root Cause |
|---|---|
| No J or Z | These require motion; static MLP can't classify them |
| ASL not CamSL | No CamSL dataset exists yet; uses ASL as proxy |
| Speech STT requires internet | Google Speech API (free tier) needs network |
| Windows-only TTS | Uses PowerShell / System.Speech |
| No sentence grammar | Fingerspelling only, no sign-order grammar |
| Common signs = alphabet only | Word signs like HELLO have no image if not in assets/ |

### Proposed Next Steps (from `claude.md` §8)

1. **Personalized Learning System** — SQLite/JSON persistent accuracy-per-letter tracking, spaced repetition scheduling for weak letters
2. **CamSL Dataset Builder** — In-app contribution mode to capture real CamSL landmarks → `data/contributions/`
3. **Sign Language Chat Assistant** — Sign-to-Text → LLM (Gemini/OpenAI) → Text-to-Sign bidirectional conversation

---

## 15. File Cross-Reference

| File | Depends On | Used By |
|---|---|---|
| `extract_landmarks.py` | mediapipe, opencv, kagglehub | Standalone (run once) |
| `add_dataset.py` | mediapipe, opencv, kagglehub | Standalone (run after extract) |
| `augment_images.py` | mediapipe, opencv | Standalone (optional) |
| `copy_sign_images.py` | mediapipe, opencv | Standalone (run once for assets) |
| `train.py` | tensorflow, sklearn, pandas | Standalone (run after data prep) |
| `landmarks.py` | mediapipe, opencv, numpy | `app.py` |
| `recognizer.py` | tensorflow | `app.py` |
| `word_builder.py` | *(stdlib only)* | `app.py` |
| `autocomplete.py` | *(stdlib only)* | `app.py`, `word_builder.py` |
| `tts.py` | subprocess, threading | `app.py` |
| `text_to_sign.py` | pathlib | `app.py`, `speech_to_sign.py` |
| `speech_to_sign.py` | SpeechRecognition, text_to_sign | Available; JS uses native STT instead |
| `app.py` | All above modules, pywebview | Entry point (`python src/app.py`) |
| `ui/index.html` | Three.js (CDN) | Loaded by pywebview |
| `ui/poses.json` | Generated from features.csv | Loaded by index.html at startup |
| `data/features.csv` | Generated by extract scripts | `train.py`, `app.py` (for poses) |
| `models/alphabet.keras` | Generated by train.py | `recognizer.py` |
| `models/hand_landmarker.task` | Downloaded from Google | `landmarks.py`, extract scripts |
| `assets/signs/*.png` | Generated by copy_sign_images.py | `app.py` (base64 sent to JS) |
