# CamSL Translator — Full Project Documentation

> **Cameroon Sign Language Translator**  
> Final-year undergraduate project. Bidirectional desktop web application bridging deaf and hearing communication via fingerspelling recognition, 3D sign animation, AI chat, and a personalised learning system.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Evolution — Old vs New](#2-architecture-evolution--old-vs-new)
3. [System Architecture (Current)](#3-system-architecture-current)
4. [Directory Structure](#4-directory-structure)
5. [Frontend — React Application](#5-frontend--react-application)
   - 5.1 [Entry Point & Routing](#51-entry-point--routing)
   - 5.2 [Global State — Zustand Store](#52-global-state--zustand-store)
   - 5.3 [MediaPipe Hook — useMediaPipe.ts](#53-mediapipe-hook--usemediapipets)
   - 5.4 [Inference Hook — useInference.ts](#54-inference-hook--useinferencets)
   - 5.5 [Landmark Normalisation — landmarks.ts](#55-landmark-normalisation--landmarksts)
   - 5.6 [Word Builder — wordBuilder.ts](#56-word-builder--wordbuilderts)
   - 5.7 [Skeleton Overlay — skeleton.ts](#57-skeleton-overlay--skeletonts)
   - 5.8 [API Layer — api.ts](#58-api-layer--apits)
   - 5.9 [TTS — tts.ts](#59-tts--ttsts)
6. [Frontend — Components](#6-frontend--components)
   - 6.1 [Layout.tsx](#61-layouttsx)
   - 6.2 [LoginPage.tsx](#62-loginpagetsx)
   - 6.3 [SignToText.tsx](#63-signtotexttsx)
   - 6.4 [TextToSign.tsx](#64-texttosigntsx)
   - 6.5 [PracticeMode.tsx](#65-practicemodetsx)
   - 6.6 [DatasetPanel.tsx](#66-datasetpaneltsx)
   - 6.7 [ChatPanel.tsx](#67-chatpaneltsx)
   - 6.8 [Hand3D.tsx](#68-hand3dtsx)
7. [3D Hand Model — Deep Dive](#7-3d-hand-model--deep-dive)
   - 7.1 [Forward Kinematics Engine — handPoses.ts](#71-forward-kinematics-engine--handposests)
   - 7.2 [Three.js Renderer — Hand3D.tsx](#72-threejs-renderer--hand3dtsx)
   - 7.3 [Letter Pose Definitions](#73-letter-pose-definitions)
8. [Backend — FastAPI](#8-backend--fastapi)
   - 8.1 [main.py](#81-mainpy)
   - 8.2 [Authentication — db_users.py & routes/auth.py](#82-authentication--db_userspy--routesauthpy)
   - 8.3 [Practice & Spaced Repetition — routes/practice.py](#83-practice--spaced-repetition--routespracticepy)
   - 8.4 [Contributions — routes/contributions.py](#84-contributions--routescontributionspy)
   - 8.5 [Auto-Retraining — routes/retrain.py](#85-auto-retraining--routesretrainpy)
   - 8.6 [AI Chat — routes/chat.py](#86-ai-chat--routeschatpy)
   - 8.7 [Autocomplete — routes/autocomplete.py](#87-autocomplete--routesautocompletepy)
9. [ML Pipeline — Python Training Side](#9-ml-pipeline--python-training-side)
   - 9.1 [Landmark Extraction — src/extract_landmarks.py](#91-landmark-extraction--srcextract_landmarkspy)
   - 9.2 [Model Training — src/train.py](#92-model-training--srctrainpy)
   - 9.3 [Weight Export — scripts/convert_model.py](#93-weight-export--scriptsconvert_modelpy)
   - 9.4 [Model Architecture](#94-model-architecture)
10. [Old Python App — src/app.py](#10-old-python-app--srcapppy)
    - 10.1 [What It Was](#101-what-it-was)
    - 10.2 [Key Modules from the Old Stack](#102-key-modules-from-the-old-stack)
11. [Key Differences — Old vs New](#11-key-differences--old-vs-new)
12. [Feature Reference](#12-feature-reference)
13. [Data Flow Diagrams](#13-data-flow-diagrams)
14. [Database Schemas](#14-database-schemas)
15. [Environment & Setup](#15-environment--setup)
16. [Known Limitations & Future Work](#16-known-limitations--future-work)

---

## 1. Project Overview

CamSL Translator is a **bidirectional sign language communication aid** that runs in a web browser. It has two core directions:

| Direction | Input | Output |
|---|---|---|
| **Sign → Text** | Webcam (live hand) | Predicted letter, built word, full sentence |
| **Text → Sign** | Typed text | Animated 3D hand showing each letter |

Additional modules:
- **Practice Mode** — webcam-based learning with spaced repetition
- **Dataset Panel** — contribute new training samples; auto-triggers retraining
- **AI Chat** — Gemini-powered conversation where you can sign your message
- **Authentication** — per-user login so practice progress is persistent

**Scope:** The manual alphabet A–Y (excluding J and Z, which require motion). 24 classes total. This is a foundational fingerspelling tool, not a full sentence grammar translator.

---

## 2. Architecture Evolution — Old vs New

The project was originally built as a **Python-only desktop application** using PyWebView (a native window around a web view, with Python acting as both UI server and ML backend). It was later fully migrated to a **React + FastAPI** architecture.

### Old Architecture (PyWebView)

```
┌─────────────────────────────────────────────────────────┐
│  Python process  (src/app.py)                           │
│                                                         │
│  ┌──────────────┐   ┌──────────────┐  ┌─────────────┐  │
│  │ Capture thread│  │  ML thread   │  │ MJPEG server│  │
│  │ (OpenCV cam) │  │ (MediaPipe + │  │ port:random │  │
│  │              │→ │  Keras MLP)  │  │             │  │
│  └──────────────┘  └──────────────┘  └─────────────┘  │
│          ↓                 ↓                 ↑          │
│     _frame_id        _state dict        JPEG bytes      │
│          └─────────────────┘                           │
│                    ↓                                    │
│           PyWebView JS bridge                           │
│           window.pywebview.api.*                        │
│                    ↓                                    │
│  ┌─────────────────────────────────────────────────┐   │
│  │  ui/index.html  (vanilla HTML/CSS/JS + Three.js)│   │
│  │  Polls get_state() every 33 ms                  │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**Problems with the old architecture:**
- `get_state()` polled at 30 Hz, serialising the full state (including a ~50 KB Base64 JPEG frame) over the IPC bridge every tick — caused GC pressure and UI jank.
- Replaced with MJPEG server (Phase 3 audit fix), but the IPC bridge remained a bottleneck for everything else.
- MediaPipe and Keras ran on the Python side — no GPU delegate available on most laptops.
- `keras.backend.clear_session()` was called during retraining, silently destroying live inference models (Phase 3 fix: removed that call).
- All logic was crammed into a single ~1200-line `app.py` God object.

### New Architecture (React + FastAPI)

```
┌────────────────────────────────┐     ┌────────────────────────────────┐
│  Browser (Vite/React)          │     │  Python (FastAPI, port 8001)   │
│                                │     │                                │
│  MediaPipe WASM                │     │  /api/auth/*                   │
│  (runs in browser, GPU accel)  │     │  /api/practice/*               │
│                                │◄────►  /api/contributions/*          │
│  TF.js (browser inference)     │ REST│  /api/retrain/*                │
│                                │     │  /api/chat/*                   │
│  Three.js (3D hand model)      │     │  /api/autocomplete/*           │
│                                │     │                                │
│  Zustand (global state)        │     │  SQLite: users.db              │
│                                │     │  SQLite: learning.db           │
│  Vite dev proxy /api → :8001   │     │  CSV:    contributions.csv     │
└────────────────────────────────┘     └────────────────────────────────┘
```

**Benefits of the new architecture:**
- MediaPipe WASM runs in the browser with GPU delegate — faster than Python+CPU.
- TF.js inference is in-browser — no IPC overhead at all for the hot path.
- The webcam stream is native `<video>` — no MJPEG server needed.
- Backend is stateless REST — easy to replace or scale independently.
- React components with Zustand give a clean reactive UI without polling.

---

## 3. System Architecture (Current)

### Request lifecycle — Sign → Text

```
Webcam frame
    │
    ▼
useMediaPipe.detect(video)          ← @mediapipe/tasks-vision WASM, GPU delegate
    │  21 landmarks {x,y,z}
    ▼
normaliseLandmarks(landmarks)       ← landmarks.ts
    │  translate to wrist origin, scale by wrist→MCP9 distance
    │  → Float32Array[63]
    ▼
useInference.predict(features)      ← TF.js, custom weight-loading
    │  → { letter, confidence }
    ▼
WordBuilder.update(letter, conf)    ← wordBuilder.ts
    │  15-frame stability buffer, no-repeat guard, space detection
    │  → committed letter / space
    ▼
Zustand store (currentLetter, currentWord, sentence)
    │
    ▼
SignToText.tsx renders results + autocomplete suggestions
```

### Request lifecycle — Text → Sign

```
User types text → clicks "Show Signs"
    │
    ▼
playSequence(text)                  ← TextToSign.tsx
    │  split into chars, filter to known A–Y set
    ▼
setCurrentChar(ch) every DELAY_MS   ← 900 ms per letter
    │
    ▼
<Hand3D letter={currentChar} />     ← Hand3D.tsx
    │  getLandmarks(letter)         ← handPoses.ts FK engine
    │  lerp currentLms → targetLms over 450 ms
    │  Three.js renders toon-shaded hand, pendulum rotation
    ▼
User sees animated 3D hand signing each letter
```

---

## 4. Directory Structure

```
camsl-translator/
│
├── frontend/                        # React application (Vite + TypeScript)
│   ├── public/
│   │   ├── mediapipe/wasm/          # WASM runtime (copied by postinstall)
│   │   └── models/alphabet/
│   │       ├── group1-shard1of1.bin # Raw float32 weights (generated by convert_model.py)
│   │       └── version.json         # Model version timestamp (written by retrain.py)
│   ├── src/
│   │   ├── App.tsx                  # Root: shows LoginPage or Layout+tab router
│   │   ├── main.tsx                 # Vite entry, mounts App
│   │   ├── components/
│   │   │   ├── Layout.tsx           # Header nav, tab switching, logout
│   │   │   ├── LoginPage.tsx        # Login / register card
│   │   │   ├── SignToText.tsx       # Live sign recognition tab
│   │   │   ├── TextToSign.tsx       # Text → 3D sign animation tab
│   │   │   ├── PracticeMode.tsx     # Spaced-repetition learning tab
│   │   │   ├── DatasetPanel.tsx     # Contribute samples + retrain tab
│   │   │   ├── ChatPanel.tsx        # Gemini AI chat tab
│   │   │   ├── Hand3D.tsx           # Three.js 3D hand renderer
│   │   │   └── icons.tsx            # SVG icon components
│   │   ├── hooks/
│   │   │   ├── useMediaPipe.ts      # HandLandmarker lifecycle
│   │   │   └── useInference.ts      # TF.js model load + predict
│   │   ├── lib/
│   │   │   ├── landmarks.ts         # Landmark normalisation (mirrors Python)
│   │   │   ├── handPoses.ts         # FK engine + 24 letter poses
│   │   │   ├── wordBuilder.ts       # Stability buffer → word/sentence builder
│   │   │   ├── skeleton.ts          # Canvas overlay drawing (object-cover aware)
│   │   │   ├── api.ts               # Typed fetch wrappers for all backend routes
│   │   │   ├── tts.ts               # Browser Web Speech API TTS
│   │   │   └── utils.ts             # cn() classname helper
│   │   └── store/
│   │       └── appStore.ts          # Zustand global state (auth, tabs, sign results, chat)
│   ├── index.html
│   ├── vite.config.ts               # Proxy /api → :8001, COEP/COOP headers
│   ├── tailwind.config.js
│   └── package.json
│
├── backend/                         # FastAPI application
│   ├── main.py                      # App factory, CORS, router mounting
│   ├── db.py                        # Leitner learning DB (SQLite)
│   ├── db_users.py                  # User accounts + sessions (SQLite)
│   └── routes/
│       ├── auth.py                  # POST /api/auth/login, /register, GET /me
│       ├── practice.py              # POST /api/practice/init, /result
│       ├── contributions.py         # POST/GET/DELETE /api/contributions
│       ├── retrain.py               # POST /api/retrain/trigger, GET /status
│       ├── chat.py                  # POST /api/chat
│       └── autocomplete.py          # GET /api/autocomplete
│
├── src/                             # Original Python app (legacy, kept for training)
│   ├── app.py                       # Old PyWebView God-object (legacy)
│   ├── train.py                     # Keras MLP training script
│   ├── extract_landmarks.py         # MediaPipe batch feature extraction
│   ├── landmarks.py                 # Python LandmarkExtractor + HolisticExtractor
│   ├── recognizer.py                # Model loader + predict wrapper
│   ├── word_builder.py              # Python word builder (mirrored in TS)
│   ├── database.py                  # LeitnerDB class (extracted from app.py)
│   ├── train_signs.py               # LSTM+Attention word-sign trainer
│   ├── record_signs.py              # OpenCV guided sign recording tool
│   ├── mjpeg.py                     # MJPEG streaming server (legacy)
│   ├── tts.py                       # pyttsx3 offline TTS (legacy)
│   ├── autocomplete.py              # English word list prefix matcher
│   ├── text_to_sign.py              # Image-based text→sign (legacy)
│   ├── speech_to_sign.py            # SpeechRecognition → text→sign
│   ├── download_models.py           # Downloads MediaPipe .task files
│   └── add_dataset.py               # Bulk feature CSV ingestion template
│
├── scripts/
│   └── convert_model.py             # Exports alphabet.keras weights to binary
│
├── data/
│   ├── raw/                         # Grassknoted ASL Alphabet images (gitignored)
│   └── features.csv                 # Extracted landmark features (63 cols + label)
│
├── models/
│   ├── alphabet.keras               # Trained alphabet MLP
│   ├── signs.keras                  # (Optional) LSTM word-sign model
│   └── signs_labels.json            # Label order for signs model
│
├── outputs/                         # Confusion matrices, training curves, metrics
├── assets/signs/                    # Reference sign images (A.png … Y.png)
├── tests/                           # pytest suite (18 tests)
│   ├── test_word_builder.py
│   └── test_landmarks.py
├── requirements.txt
├── CLAUDE.md                        # Project memory / instructions for Claude Code
└── DOCUMENTATION.md                 # This file
```

---

## 5. Frontend — React Application

### 5.1 Entry Point & Routing

**`src/main.tsx`** mounts the React app with `ReactDOM.createRoot`.

**`src/App.tsx`** is the root component. It reads `token` from the Zustand store. If no token is present (not logged in), it renders `<LoginPage />`. Otherwise it renders `<Layout>` with the active tab's component:

```
token == null  →  <LoginPage />
token != null  →  <Layout>
                    sign2text  →  <SignToText />
                    text2sign  →  <TextToSign />
                    practice   →  <PracticeMode />
                    dataset    →  <DatasetPanel />
                    chat       →  <ChatPanel />
                  </Layout>
```

**`vite.config.ts`** configures two critical things:
1. **Proxy**: all `/api/*` requests are forwarded to `http://localhost:8001` — so the frontend never hard-codes the backend port.
2. **COEP/COOP headers**: `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin` are required to enable SharedArrayBuffer, which MediaPipe's WASM runtime needs for multi-threading.

---

### 5.2 Global State — Zustand Store

**`src/store/appStore.ts`** holds all cross-component state in a single Zustand store (no prop-drilling, no context providers):

| State slice | What it holds |
|---|---|
| **Auth** | `token`, `username`, `userId` — persisted in `localStorage` |
| **activeTab** | Which of the 5 tabs is displayed |
| **Sign→Text** | `currentLetter`, `confidence`, `currentWord`, `sentence`, `suggestions` |
| **Practice** | `sessionId`, `practiceTarget`, `practiceMastery`, `practiceHistory` |
| **Chat** | `chatHistory` (last 40 messages) |

`sessionId` is the user's `userId` when logged in, or a UUID stored in localStorage for anonymous use. This ties practice progress to the user across sessions.

Auth is persisted by writing to `localStorage` on `setAuth()` and cleared on `logout()`. On startup, `loadAuth()` reads back from `localStorage` so the user stays logged in after a page refresh.

---

### 5.3 MediaPipe Hook — useMediaPipe.ts

Manages the entire `HandLandmarker` lifecycle. Called by `SignToText`, `PracticeMode`, and `DatasetPanel`.

**Initialisation sequence:**
1. Resolve WASM fileset from `/mediapipe/wasm/` (local, no CDN)
2. Try to create `HandLandmarker` with `delegate: "GPU"` (WebGL acceleration)
3. On failure (GPU unavailable), silently fall back to `delegate: "CPU"`
4. Set `ready = true` — components show a yellow pulsing badge until this fires

**WASM files** are copied from `node_modules/@mediapipe/tasks-vision/wasm/` into `public/mediapipe/wasm/` by a `postinstall` script in `package.json`, so they are served locally and the app works offline.

**`detect(video)`** calls `detectForVideo(video, performance.now())` and returns:
```typescript
{ landmarks: RawLandmark[] | null, handedness: string | null }
```
`RawLandmark` is `{ x, y, z }` normalised 0–1 in image space.

---

### 5.4 Inference Hook — useInference.ts

Handles the TF.js alphabet model. This was the most technically complex part of the migration because **Keras 3.x `model.to_json()` is incompatible with `tf.loadLayersModel()`** in TF.js.

**Solution:** Instead of using any format converter, the hook:
1. Builds the model architecture directly in TF.js code (mirroring `src/train.py` exactly)
2. Fetches the raw binary weights file `group1-shard1of1.bin`
3. Slices the flat `Float32Array` according to `WEIGHT_SPECS` (tensor shapes in order)
4. Sets weights layer-by-layer with `layer.setWeights()`

**Architecture built in JS** (must exactly match `src/train.py`):
```
Input(63)
  → Dense(256, relu) → BatchNormalization → Dropout(0.3)
  → Dense(128, relu) → BatchNormalization → Dropout(0.3)
  → Dense(64, relu)  → BatchNormalization → Dropout(0.3)
  → Dense(24, softmax)
```

**Weight binary layout** (`WEIGHT_SPECS` array defines shapes in order):
```
Dense256:  kernel[63,256]  bias[256]
BN256:     gamma[256]  beta[256]  moving_mean[256]  moving_var[256]
Dense128:  kernel[256,128]  bias[128]
BN128:     gamma[128]  beta[128]  moving_mean[128]  moving_var[128]
Dense64:   kernel[128,64]  bias[64]
BN64:      gamma[64]  beta[64]  moving_mean[64]  moving_var[64]
Dense24:   kernel[64,24]  bias[24]
```

**Hot-reload:** When `DatasetPanel` detects a completed retrain, it dispatches:
```javascript
window.dispatchEvent(new CustomEvent("camsl:model-updated", { detail: { version } }))
```
`useInference` listens for this event and re-fetches the weights with a `?v=<timestamp>` cache-bust URL, reloading the model in-place without a page refresh.

**Labels:** 24 letters in the string `"ABCDEFGHIKLMNOPQRSTUVWXY"` (J and Z excluded). Index in this string corresponds to model output neuron index.

---

### 5.5 Landmark Normalisation — landmarks.ts

Ported exactly from `src/landmarks.py`. Must stay in sync — any difference causes a train/inference mismatch and drops accuracy.

**Algorithm:**
1. Translate all 21 landmarks so landmark 0 (wrist) is at the origin
2. Compute scale = Euclidean distance from wrist (0) to middle-finger MCP (landmark 9)
3. Divide all coordinates by scale

Result: a **63-float translation- and scale-invariant feature vector**. The hand can be anywhere in the frame at any distance and the features remain the same.

Also contains `buildHolisticFeatures()` (150 features = hand + face + pose) for the word-sign LSTM model — not used in the main alphabet inference path but kept for the signs model.

---

### 5.6 Word Builder — wordBuilder.ts

Ported from `src/word_builder.py`. Converts a stream of per-frame predictions into words and sentences.

**Constants:**
| Constant | Value | Meaning |
|---|---|---|
| `STABILITY_FRAMES` | 15 | ~0.5 s at 30 fps |
| `SPACE_FRAMES` | 20 | ~0.67 s no-hand → insert space |
| `CONFIDENCE_THRESHOLD` | 0.80 | Minimum confidence to consider a prediction |

**Algorithm per frame:**
1. If confidence < 0.80 or no hand: increment no-hand counter; reset buffer; if no-hand count ≥ SPACE_FRAMES and word is non-empty, flush word + space to sentence.
2. Else: push letter to rolling buffer (max `STABILITY_FRAMES`).
3. If buffer is full AND all entries agree AND letter ≠ last committed letter → **commit** the letter.
4. The no-repeat guard (`letter === lastCommitted`) prevents the same letter from being committed twice without removing the hand.

**Extra methods:**
- `acceptSuggestion(word)` — accepts an autocomplete word, appends to sentence, clears current word
- `backspace()` — removes last character of current word, or last word of sentence
- `clear()` — full reset

---

### 5.7 Skeleton Overlay — skeleton.ts

Draws the 21 MediaPipe landmarks on a `<canvas>` overlaid on the `<video>`.

**The object-cover coordinate problem:** The video element uses CSS `object-cover`, which crops the video to fill its container. MediaPipe gives normalised coordinates (0–1) in the **video's native resolution**. The canvas is sized to the **container's client dimensions**. These don't match unless the aspect ratios are identical.

**Solution — object-cover transform:**
```typescript
const scale = Math.max(containerW / videoW, containerH / videoH);
const renderedW = videoW * scale;
const renderedH = videoH * scale;
const offsetX = (containerW - renderedW) / 2;
const offsetY = (containerH - renderedH) / 2;

// Mirror x because video has CSS scale-x-[-1] (mirror mode)
const px = (lm) => ({
  x: (1 - lm.x) * renderedW + offsetX,
  y: lm.y * renderedH + offsetY,
});
```

The canvas itself has **no** CSS transform — the mirroring is handled purely in the coordinate math. (An earlier version applied `scale-x-[-1]` to the canvas AND mirrored in code, causing a double-flip.)

---

### 5.8 API Layer — api.ts

Thin typed wrappers around `fetch`. The base URL is `""` (empty string) in development so that Vite's proxy catches `/api/*` and forwards to port 8001. In production, `VITE_API_URL` can be set to an absolute URL.

| Function | Method | Route | Used by |
|---|---|---|---|
| `sendChat` | POST | `/api/chat` | ChatPanel |
| `getAutocomplete` | GET | `/api/autocomplete` | SignToText |
| `initPractice` | POST | `/api/practice/init` | PracticeMode |
| `recordPracticeResult` | POST | `/api/practice/result` | PracticeMode |
| `addContribution` | POST | `/api/contributions` | DatasetPanel |
| `getContributionCounts` | GET | `/api/contributions/counts` | DatasetPanel |
| `deleteLastContribution` | DELETE | `/api/contributions/last` | DatasetPanel |
| `triggerRetrain` | POST | `/api/retrain/trigger` | DatasetPanel |
| `getRetrainStatus` | GET | `/api/retrain/status` | DatasetPanel |

---

### 5.9 TTS — tts.ts

Uses the **browser's native Web Speech API** (`SpeechSynthesisUtterance`). No Python backend call, no extra package. Works offline. Called from `SignToText` (speak sentence button) and `TextToSign` (speak text button).

---

## 6. Frontend — Components

### 6.1 Layout.tsx

Persistent shell around all tabs. Contains:
- **Brand header**: logo icon, "CamSL Translator" title, "Cameroon Sign Language" subtitle
- **Nav strip**: 5 tab buttons (Sign→Text, Text→Sign, Practice, Dataset, AI Chat) with active highlight
- **User bar**: username display + logout button (top-right)

On logout, clears localStorage auth keys and sets Zustand token to null, which causes `App.tsx` to re-render to `<LoginPage />`.

---

### 6.2 LoginPage.tsx

Full-screen dark claymorphism card with a Login / Register tab toggle. On submit:
- Calls `/api/auth/login` or `/api/auth/register`
- On success, calls `useAppStore().setAuth(token, username, userId)` which persists to localStorage and transitions to the main app

---

### 6.3 SignToText.tsx

The main live recognition tab. Layout: full-height webcam left, controls right.

**Camera setup:** `getUserMedia` → `<video autoPlay muted playsInline>`. The `autoPlay` attribute (not a manual `.play()` call) avoids the React StrictMode AbortError where the component unmounts and remounts between `getUserMedia` resolving and `.play()` being called.

**RAF loop** (requestAnimationFrame):
1. Call `detect(video)` → landmarks
2. Draw skeleton on canvas overlay
3. Call `predict(normaliseLandmarks(landmarks))` → `{ letter, confidence }`
4. Feed to `WordBuilder.update()`
5. If something committed, call `getAutocomplete(prefix)` and update suggestions
6. Update Zustand store

**Word display**: current partial word highlighted, sentence below it, up to 4 autocomplete suggestion chips.

**Controls**: Speak (TTS), Backspace, Clear, suggestion chips.

---

### 6.4 TextToSign.tsx

Text input → animated 3D hand. Layout: narrow controls left, full-height 3D display right.

**playSequence(text):**
1. Filters input to known letters + spaces
2. Iterates with `setTimeout` at `DELAY_MS = 900 ms` per character
3. Calls `setCurrentChar(ch)` — `Hand3D` re-renders and lerps to new pose
4. Spaces create a shorter pause (`DELAY_MS / 2`) without changing the hand pose

**Display area:** `<Hand3D>` fills the entire right panel. A teal badge at the bottom shows the current letter (grey dash when idle). A hint text at the top fades in when idle.

**Idle pose:** `IDLE_LETTER = "B"` (open flat hand) — chosen because it's the most neutral-looking static pose.

---

### 6.5 PracticeMode.tsx

Spaced-repetition learning: the app picks a letter, the user signs it, the camera checks it.

**Layout:**
- Left: full-height webcam with live skeleton overlay and detected-letter badge
- Right: compact header strip (target letter + mastery bar + skip) + Hand3D 3D reference below

**Flow:**
1. `initPractice(sessionId)` → gets the next letter to practice from the backend Leitner system
2. User signs the letter; the RAF loop detects it using the same MediaPipe + TF.js path
3. When the same high-confidence letter (`>= 0.85`) is held for `HOLD_FRAMES = 20` frames (~0.67 s), `handleResult` fires
4. Green overlay (`✓`) or red overlay (`✗`) is shown for 1.2 s
5. `recordPracticeResult(sessionId, letter, correct, recentLetters)` → backend advances Leitner box
6. Next letter is shown; Hand3D smoothly animates to the new pose

**Hold detection:** Uses a 20-element rolling buffer (`holdRef`). Every frame where the predicted letter matches the target at ≥ 0.85 confidence pushes to the buffer. When all 20 entries agree, the result is committed.

---

### 6.6 DatasetPanel.tsx

Webcam-based data collection for expanding the training set.

**Capture flow:**
1. User selects a letter (A–Y grid)
2. User forms handshape and clicks "Capture"
3. MediaPipe runs for 700 ms, collecting landmark frames
4. Frames are averaged into one 63-float feature vector
5. Sent to `/api/contributions` (POST)
6. After every **25 contributions**, auto-retrain fires on the backend

**Retrain status card:** polls `/api/retrain/status` every 2 s while `state === "running"`. Changes colour: navy (idle) → yellow (running) → teal (done) → red (failed). When done, dispatches `camsl:model-updated` CustomEvent so `useInference` hot-reloads the weights.

**Delete last sample**: calls `DELETE /api/contributions/last` — removes the last row from `contributions.csv`. Useful for correcting a bad capture.

---

### 6.7 ChatPanel.tsx

Gemini-powered AI chat where signed words type directly into the input box.

**Sign staging:** The `currentWord` from the sign recognition state (Zustand) is shown in a staging area. A button appends it to the chat input field.

**Send flow:** User types or stages a message → sends → `POST /api/chat` with message + last 20 turns of history → AI reply shown in chat bubble.

**Bubble actions:** Each AI reply has a "Speak" button (TTS) and a "Show Signs" button (switches to Text→Sign tab with that text pre-loaded).

---

### 6.8 Hand3D.tsx

The 3D toon-shaded hand component used by both `TextToSign` and `PracticeMode`. Detailed in section 7.

---

## 7. 3D Hand Model — Deep Dive

### 7.1 Forward Kinematics Engine — handPoses.ts

**Coordinate system:**
- Wrist at origin `(0, 0, 0)`
- Fingers point in `+Y` when fully extended
- Palm faces `+Z` (toward the viewer)
- `+X` is to the right of the hand
- Curling fingers rotates them toward `+Z`

**Core maths — `rotV(v, axis, degrees)`:**  
Rodrigues' rotation formula applied to a 3-component vector. Used to rotate a direction vector around an axis by a given angle:
```
v*cos(a) + cross(axis, v)*sin(a) + axis*(axis·v)*(1-cos(a))
```

**Core function — `chain(start, up, bendAxis, spread, lens, bends)`:**  
Computes the 4 positions of one finger using forward kinematics:
1. Apply lateral spread: rotate `up` around `[0,1,0]` by `spread` degrees
2. Iterate through 3 segments: accumulate bend angle, rotate `up2` around `bendAxis`, step forward by segment length
3. Returns `[MCP, PIP, DIP, TIP]` positions

**Anatomy constants:**
```
Segment lengths (normalised):
  Thumb:  [0.10, 0.09, 0.07]
  Index:  [0.14, 0.10, 0.08]
  Middle: [0.16, 0.11, 0.09]
  Ring:   [0.14, 0.10, 0.08]
  Pinky:  [0.11, 0.08, 0.06]

MCP knuckle positions (relative to wrist):
  Index MCP:  (-0.10, 0.38, 0)
  Middle MCP: ( 0.00, 0.40, 0)
  Ring MCP:   ( 0.10, 0.38, 0)
  Pinky MCP:  ( 0.19, 0.33, 0)
  Thumb CMC:  (-0.22, 0.12, 0.04)
```

**Output — `getLandmarks(letter)`:**  
Returns 63 floats (21 × xyz) in **MediaPipe landmark order** (0=wrist, 1–4=thumb, 5–8=index, 9–12=middle, 13–16=ring, 17–20=pinky), scaled by `HAND_SCALE = 3` so the hand is large enough in Three.js world space.

---

### 7.2 Three.js Renderer — Hand3D.tsx

**Scene setup (inside `useEffect`):**
- `WebGLRenderer` with `alpha: true` — transparent background, inherits the card's dark colour
- Perspective camera at `(0.4, 1.2, 2.8)` looking at `(0, 0.9, 0)` — 3/4 view from slightly above
- `AmbientLight(0xffffff, 0.8)` + `DirectionalLight(0xffffff, 1.3)` from upper-right + fill light from left

**Toon shading:**  
A 2-pixel `CanvasTexture` is used as a `gradientMap` for all `MeshToonMaterial` instances:
- Pixel 0 (`#404040`): shadow colour
- Pixel 1 (`#d0d0d0`): lit colour
- `NearestFilter` ensures hard-step cel-shading (no gradient interpolation)

**Outline effect (inverted-hull technique):**  
Every mesh gets a child mesh with `side: THREE.BackSide` (renders only the back faces) and `scale.setScalar(1.15)`. Since the child is scaled up, its back faces peek out behind the main mesh, creating a dark outline. Critically, the outline is a **child** of the main mesh — it follows the mesh's `position.set()` automatically. If it were a sibling, all outlines would stack at the group origin.

**Geometry:**
- 21 joint spheres: `SphereGeometry(JOINT_R=0.024, 10, 8)` for knuckles, `SphereGeometry(TIP_R=0.030)` for fingertips (slightly larger)
- One cylinder per bone connection: `CylinderGeometry(BONE_R=0.016, BONE_R, 1, 8)` with `scale.y = len` to match the actual bone length

**Bone orientation:**  
Cylinders lie along the Y axis by default. To align a cylinder from point A to B:
```typescript
const dir = pb.clone().sub(pa).normalize();
bone.position.copy(midpoint);
bone.scale.set(1, distance, 1);
bone.quaternion.setFromUnitVectors(new Vector3(0,1,0), dir);
```

**Animation loop:**
- **Pendulum rotation:** `group.rotation.y = Math.sin(t * freq) * 0.52` — oscillates ±30° so the user sees the 3D shape from different angles
- **Pose interpolation:** When the letter prop changes, `lerpFrom` is snapshot and `lerpStart` is set to `now`. Each tick computes `t = (now - lerpStart) / 450ms`, applies ease-in-out quad, and lerps all 63 floats

**Cleanup:** On unmount, `cancelAnimationFrame`, `ResizeObserver.disconnect()`, `renderer.dispose()`, canvas removed from DOM.

**ResizeObserver:** Watches the container element. On resize, updates `renderer.setSize()` and `camera.aspect` — the 3D view fills any container size correctly.

---

### 7.3 Letter Pose Definitions

All 24 letters are defined in `handPoses.ts` as joint bend angles. Angles in degrees — MCP, PIP, DIP are the three joints from knuckle to fingertip:

| Letter | Description | Key angles |
|---|---|---|
| A | Fist, thumb alongside | All fingers: mcp=70, pip=90, dip=75 |
| B | Four fingers straight, thumb tucked | All: 0,0,0; thumb: mcp=85 tucked |
| C | C-curve | All: mcp=40, pip=35, dip=20 |
| D | Index up, others fist | Index: 0,0,0; rest: fist |
| E | Tight curl, fingers on palm | All: mcp=80, pip=100, dip=80 |
| F | Index+thumb circle, rest extended | Index: pip=52, others straight |
| G | Index horizontal (spread=-38°) | Index spread left, rest fist |
| H | Index+middle horizontal | Both spread, rest fist |
| I | Pinky up, rest fist | Pinky: 0,0,0; rest: fist |
| K | Index+middle up, thumb between | Index straight, middle pip=45 |
| L | Index up, thumb out sideways | Index straight, thumb spread=-30° |
| M | Three fingers over thumb | Index+middle+ring: mcp=68, pip=72 |
| N | Two fingers over thumb | Index+middle: mcp=68 |
| O | O-shape, all curved | All: mcp=52, pip=55, dip=32 |
| P | K-shape (index+middle up) | Similar to K |
| Q | G-shape (index straight) | Index straight, rest fist |
| R | Index+middle crossed (spread -8,-14) | Both slight negative spread |
| S | Fist, thumb over fingers | All fist, thumb mcp=32 |
| T | Thumb between index+middle | All fist, thumb spread=0° |
| U | Index+middle together up | Both spread ±4°, rest fist |
| V | Peace sign (index+middle spread) | Both spread ±12°, rest fist |
| W | Three fingers spread | Index+middle+ring spread ±10° |
| X | Index hooked (pip=62) | Index: pip=62, dip=48, rest fist |
| Y | Pinky + thumb out (shaka) | Pinky up, thumb spread=-30° |

---

## 8. Backend — FastAPI

### 8.1 main.py

The FastAPI application factory. Sets up:
- **CORS middleware**: allows `*` by default (development). Set `ALLOWED_ORIGIN` env var to restrict in production.
- **Startup**: calls `db_users.init()` to create the users/sessions tables if they don't exist.
- **Routers**: all mounted under `/api` prefix.

Health check: `GET /health` returns `{"status": "ok", "version": "2.0.0"}`.

---

### 8.2 Authentication — db_users.py & routes/auth.py

**Storage:** SQLite at `backend/data/users.db`, WAL journal mode.

**Schema:**
```sql
CREATE TABLE users (
    id       TEXT PRIMARY KEY,   -- random 32-byte hex
    username TEXT UNIQUE NOT NULL,
    pw_hash  TEXT NOT NULL,      -- "salt:hash"
    created  REAL NOT NULL       -- Unix timestamp
);

CREATE TABLE sessions (
    token    TEXT PRIMARY KEY,   -- random 64-byte hex
    user_id  TEXT NOT NULL,
    username TEXT NOT NULL,
    created  REAL NOT NULL
);
```

**Password hashing:** PBKDF2-HMAC-SHA256 with a random 16-byte hex salt and **260,000 iterations** (NIST recommended minimum). Format stored: `"<salt_hex>:<hash_hex>"`.

**Sessions:** One active session per user. On new login, all old sessions for that user are deleted before inserting the new token. Token is 32-byte random hex (64 char string).

**Routes:**
- `POST /api/auth/register` — creates user, returns token + username + user_id
- `POST /api/auth/login` — verifies password, returns token + username + user_id
- `GET /api/auth/me` — validates token from `Authorization: Bearer` header

---

### 8.3 Practice & Spaced Repetition — routes/practice.py

The practice system implements the **Leitner Box** spaced repetition algorithm.

**How Leitner Boxes work:**
- Each letter starts in Box 1 (reviewed most frequently)
- Correct answer → letter moves to the next box (reviewed less often)
- Wrong answer → letter goes back to Box 1
- Box number determines how many sessions before the letter is due again

**Backend DB** (`backend/db.py` → `LeitnerDB`):
```sql
CREATE TABLE leitner (
    session_id TEXT,
    letter     TEXT,
    box        INTEGER DEFAULT 1,
    next_review INTEGER DEFAULT 0,
    streak     INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, letter)
);
```

**`POST /api/practice/init`:** Selects the next letter using a priority queue:
1. Due letters (next_review ≤ current session count) sorted by box ascending (lowest box = most overdue)
2. If none due, pick the letter with lowest box that isn't in `recent` (avoids repeating the same letter)

**`POST /api/practice/result`:** Updates the Leitner box:
- Correct: `box = min(box + 1, 5)`, `next_review = current + interval[box]`
- Wrong: `box = 1`, `next_review = current + 1`
- Returns next letter + overall mastery percentage (average box / 5 × 100)

---

### 8.4 Contributions — routes/contributions.py

User-submitted training samples stored in `backend/data/contributions.csv`.

**CSV format:** `label,features` where features is 63 comma-separated floats.

**Routes:**
- `POST /api/contributions` — appends one row; calls `maybe_auto_retrain(total)` after every save
- `GET /api/contributions/counts` — counts rows per label + total
- `DELETE /api/contributions/last` — removes the last row (undo bad capture)

---

### 8.5 Auto-Retraining — routes/retrain.py

The most complex backend module. Runs entirely in-process on a daemon thread — no subprocesses.

**Trigger condition:** Every 25 contributions (`AUTO_RETRAIN_EVERY = 25`), `maybe_auto_retrain()` is called. It checks that the count is a multiple of 25 and not the same count as the last trigger (prevents double-firing).

**Pipeline steps:**
1. **Read contributions** from `contributions.csv`
2. **Load base dataset** from `data/features.csv` (the original alphabet training data)
3. **Merge and build arrays** — shuffle with fixed seed (42), 80/20 train/val split
4. **Build model** — same architecture as `src/train.py` (Dense 256→128→64→N + BN + Dropout)
5. **Train** — 20 fast epochs, `EarlyStopping(patience=5)`, TF thread limits set to 2 to avoid competing with the live inference path
6. **Export binary** — iterates `model.layers`, writes all `layer.weights` as flat float32 bytes to `frontend/public/models/alphabet/group1-shard1of1.bin`
7. **Bump version** — writes `{ "v": <unix_timestamp> }` to `version.json`
8. Memory cleanup: `del model, X, y; gc.collect()`

**State machine:** `idle → running → done/failed`. Frontend polls `/api/retrain/status` every 2 s while running.

**Safety guards:**
- Concurrent retrain guard: returns early if already running
- Minimum 50 samples required
- TF thread count capped to avoid starvation of live inference
- `keras.backend.clear_session()` is explicitly NOT called (it would destroy all other Keras models in the process)

---

### 8.6 AI Chat — routes/chat.py

Calls the **Gemini API** (`gemini-2.5-flash`) via standard `urllib.request` — no Google SDK needed.

**System prompt:** Instructs Gemini to act as a helpful sign language learning assistant, keep responses concise, and be aware the user may be communicating via fingerspelling.

**Input sanitisation (Phase 2 audit fix):**
- `message` capped at 1,000 characters
- `history` capped at last 20 turns × 2,000 chars each
- Both type-checked before any API call (prompt injection guard)

Requires `GEMINI_API_KEY` environment variable.

---

### 8.7 Autocomplete — routes/autocomplete.py

`GET /api/autocomplete?prefix=HEL&n=4` returns up to 4 English words starting with the given prefix, drawn from a built-in word frequency list. Used by `SignToText` to show word completion chips after each committed letter.

---

## 9. ML Pipeline — Python Training Side

### 9.1 Landmark Extraction — src/extract_landmarks.py

Batch-processes the **Grassknoted ASL Alphabet** dataset (Kaggle): a directory of images organised by letter folder. For each image:
1. Runs MediaPipe `HandLandmarker` (Tasks API, not the deprecated `solutions.hands`)
2. Normalises 21 landmarks using the same wrist-origin + landmark-9-scale formula as `landmarks.ts`
3. Appends a row to `data/features.csv`

J and Z are excluded (they require motion). Output: one row per image, 63 feature columns + `label`.

---

### 9.2 Model Training — src/train.py

Trains the alphabet MLP and optionally a RandomForest baseline.

**Key design decisions:**
- **Data augmentation**: Gaussian noise added to `X_train` (4× augmented copies). **Applied to both** the Keras MLP and the RandomForest baseline (Phase 2 audit fix — previously the baseline ran on unaugmented data, creating a false accuracy gap that looked like scientific misconduct).
- **Train/val/test split**: 70 / 15 / 15
- **EarlyStopping**: `patience=15` on `val_accuracy`
- **ReduceLROnPlateau**: halves LR when val_accuracy plateaus for 8 epochs
- **Output**: `models/alphabet.keras`, `outputs/confusion_matrix.png`, `outputs/training_curves.png`, `outputs/results.txt`

---

### 9.3 Weight Export — scripts/convert_model.py

Converts `models/alphabet.keras` to the raw binary format expected by `useInference.ts`.

```python
model = tf.keras.models.load_model("models/alphabet.keras")
with open("frontend/public/models/alphabet/group1-shard1of1.bin", "wb") as f:
    for layer in model.layers:
        for w in layer.weights:
            f.write(w.numpy().astype(np.float32).tobytes())
```

No `tensorflowjs` package required. The binary is a flat concatenation of all weight tensors in layer iteration order, matching `WEIGHT_SPECS` in `useInference.ts`.

---

### 9.4 Model Architecture

```
Input: 63 features (21 landmarks × xyz, normalised)

Dense(256, activation='relu')
BatchNormalization()
Dropout(0.3)

Dense(128, activation='relu')
BatchNormalization()
Dropout(0.3)

Dense(64, activation='relu')
BatchNormalization()
Dropout(0.3)

Dense(24, activation='softmax')   ← 24 letter classes (A–Y, excl J,Z)

Optimizer: Adam(lr=1e-3)
Loss: sparse_categorical_crossentropy
Total parameters: ~107,000
```

---

## 10. Old Python App — src/app.py

### 10.1 What It Was

`src/app.py` was the original monolithic application. It ran a PyWebView window (a native OS window containing a web view) and exposed Python methods to JavaScript via `window.pywebview.api.*`. The frontend (`ui/index.html`) polled `get_state()` every 33 ms to update the UI.

**Thread model:**
- **Capture thread**: OpenCV `VideoCapture(0, CAP_DSHOW)` reads frames, pushes to `_frame_id` counter
- **ML thread**: When `_frame_id` changes, runs MediaPipe + Keras inference, updates `_state` dict
- **MJPEG thread**: `ThreadingHTTPServer` streams JPEG frames to `<img src=url>` in the UI
- **Retraining thread**: daemon thread running the training loop when triggered

---

### 10.2 Key Modules from the Old Stack

| Module | Purpose | Status |
|---|---|---|
| `src/app.py` | PyWebView God-object | Legacy — kept for reference |
| `src/landmarks.py` | `LandmarkExtractor` (hand-only 63 feat) + `HolisticExtractor` (150 feat) | Superseded by `landmarks.ts` for live inference; still used for training |
| `src/recognizer.py` | Loads `alphabet.keras`, provides `predict()`, supports hot-reload via `load_model()` | Superseded by `useInference.ts` |
| `src/word_builder.py` | Python word builder | Mirrored exactly in `wordBuilder.ts` |
| `src/database.py` | `LeitnerDB` class (extracted from app.py in Phase 2 audit) | Logic now in `backend/db.py` |
| `src/mjpeg.py` | `MjpegServer` — replaced Base64 IPC for video streaming | No longer needed (native browser video) |
| `src/tts.py` | `pyttsx3` offline TTS | Superseded by browser Web Speech API |
| `src/train_signs.py` | LSTM + MultiHeadAttention model for word-sign sequences | Optional, not used in React app |
| `src/record_signs.py` | OpenCV guided sign recording (W/S navigate, SPACE record, D delete) | Optional tool |

---

## 11. Key Differences — Old vs New

| Aspect | Old (PyWebView) | New (React + FastAPI) |
|---|---|---|
| **UI framework** | Vanilla HTML/CSS/JS in `ui/index.html` | React + TypeScript + Tailwind CSS |
| **State management** | Global `_state` dict polled every 33 ms | Zustand reactive store, event-driven |
| **MediaPipe** | Python `mediapipe.tasks.python.vision` | Browser `@mediapipe/tasks-vision` WASM |
| **ML inference** | Python `tf.keras.models.load_model` | TF.js with custom binary weight loading |
| **Webcam feed** | OpenCV → MJPEG server → `<img src>` | Native `<video>` element, no server needed |
| **IPC overhead** | PyWebView bridge: JSON-serialised `get_state()` at 30 Hz | Zero — inference and landmark detection run in browser |
| **Authentication** | None | PBKDF2 hashed passwords, SQLite sessions, Zustand + localStorage |
| **TTS** | `pyttsx3` (Python, offline) | Web Speech API (browser, offline) |
| **3D hand model** | Three.js avatar in `ui/index.html` (JS), Maya cartoon style | `Hand3D.tsx` React component, FK-based letter poses, toon shading |
| **Text→Sign** | Static PNG images (`assets/signs/A.png`) | Animated 3D hand model |
| **Retraining** | Background thread in `app.py`, `keras.backend.clear_session()` (buggy) | Isolated `retrain.py` route module, no `clear_session()`, TF thread limits |
| **Video streaming fix** | Phase 3: replaced Base64 IPC with MJPEG server | Not needed — browser handles video natively |
| **Word-sign model** | LSTM + Attention on Python side | Architecture defined in `train_signs.py`, not ported to browser yet |

---

## 12. Feature Reference

### Sign → Text
- Live 30 fps hand detection via MediaPipe WASM (GPU accelerated)
- 24-letter alphabet (A–Y, excluding J, Z)
- 63-feature normalised landmark vector (translation + scale invariant)
- 15-frame stability buffer prevents flickering
- No-repeat guard (must remove hand between same letters)
- Open-palm / no-detection for ~0.67 s inserts a word space
- Up to 4 autocomplete suggestions after each letter
- Speak sentence via TTS (Web Speech API)
- Backspace and clear controls
- Live skeleton overlay (mirrored, object-cover aware)

### Text → Sign
- Animated 3D toon-shaded hand model (Three.js)
- Forward kinematics — 24 pre-defined letter poses
- 450 ms ease-in-out interpolation between letters
- 900 ms display time per letter
- Pendulum auto-rotation (±30°) to show 3D depth
- TTS button reads the typed text aloud
- Idle pose (open flat hand B) while not playing

### Practice Mode
- Leitner 5-box spaced repetition system
- Per-user progress tied to account (persistent across sessions)
- Letters due soonest / in lowest boxes shown first
- 20-frame hold detection at ≥ 0.85 confidence to confirm a sign
- Correct / wrong full-screen overlay (1.2 s)
- Skip button to advance without counting as wrong
- 3D reference hand (right column) shows the target letter's pose
- Mastery percentage bar (average box level across all 24 letters)

### Dataset Panel
- Webcam capture with 700 ms collection window (averaged over frames)
- A–Y label selector grid
- Sample count per letter + total
- Auto-retrain after every 25 contributions
- Manual "Retrain Now" button
- Retrain status card (idle / running / done / failed)
- Live progress bar to next retrain threshold
- Delete last sample (undo bad capture)
- Hot model reload — no page refresh needed after retrain

### AI Chat
- Gemini 2.5 Flash model via Gemini API
- Sign words directly into the chat input via staging area
- Up to 20 turns of conversation history sent with each message
- Prompt injection guard (message capped at 1,000 chars)
- Speak button on each AI reply (TTS)
- Show Signs button — loads reply text into Text→Sign panel
- Conversation history stored in Zustand (last 40 messages)

### Authentication
- Register / Login tab toggle on a single card
- PBKDF2-HMAC-SHA256, 260,000 iterations
- One active session per user (old sessions invalidated on new login)
- Tokens stored in localStorage, sent automatically via Zustand state
- Logout clears all localStorage auth keys

---

## 13. Data Flow Diagrams

### Sign → Text (hot path, runs every frame)

```
Browser RAF
  │
  ├─► MediaPipe WASM (GPU)
  │       21 landmarks {x,y,z}
  │
  ├─► normaliseLandmarks()          [landmarks.ts]
  │       → Float32Array[63]
  │
  ├─► tf.tidy(() => model.predict()) [useInference.ts, TF.js]
  │       → { letter, confidence }
  │
  ├─► WordBuilder.update()           [wordBuilder.ts]
  │       → committed? letter / null
  │
  ├─► (on commit) GET /api/autocomplete?prefix=...
  │       → string[]
  │
  └─► useAppStore.setSignResult()    [Zustand]
          → React re-render
```

### Retraining Pipeline

```
User captures 25th sample
  │
  ▼
POST /api/contributions             [contributions.py]
  │  append to contributions.csv
  │
  ├─► maybe_auto_retrain(total)     [retrain.py]
  │       total % 25 == 0 → fire
  │
  ▼
daemon thread: _run_pipeline()
  │
  ├─► read contributions.csv
  ├─► read data/features.csv
  ├─► merge + shuffle + split 80/20
  ├─► build Keras MLP (same arch as train.py)
  ├─► train 20 epochs (EarlyStopping patience=5)
  ├─► write flat float32 binary
  │     → frontend/public/models/alphabet/group1-shard1of1.bin
  ├─► write version.json { "v": <timestamp> }
  └─► _state["state"] = "done"

Frontend: DatasetPanel polls GET /api/retrain/status every 2s
  │  state == "done", new version detected
  │
  ▼
window.dispatchEvent("camsl:model-updated", { version })

useInference listener
  │
  ├─► fetch group1-shard1of1.bin?v=<timestamp>   (cache-busted)
  ├─► slice Float32Array → tensors → setWeights()
  └─► setReady(true) — new model active, no page refresh
```

---

## 14. Database Schemas

### backend/data/users.db

```sql
-- User accounts
CREATE TABLE users (
    id       TEXT PRIMARY KEY,     -- hex(16)
    username TEXT UNIQUE NOT NULL,
    pw_hash  TEXT NOT NULL,        -- "<salt_hex>:<hash_hex>"
    created  REAL NOT NULL         -- time.time()
);

-- Active sessions (one per user)
CREATE TABLE sessions (
    token    TEXT PRIMARY KEY,     -- hex(32)
    user_id  TEXT NOT NULL,
    username TEXT NOT NULL,
    created  REAL NOT NULL
);
```

### backend/data/learning.db (Leitner)

```sql
-- Spaced repetition state per user+letter
CREATE TABLE leitner (
    session_id TEXT NOT NULL,
    letter     TEXT NOT NULL,
    box        INTEGER DEFAULT 1,       -- 1 (frequent) to 5 (rare)
    next_review INTEGER DEFAULT 0,      -- session count when due
    streak     INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, letter)
);
CREATE INDEX idx_leitner_review ON leitner(next_review, box);
```

### backend/data/contributions.csv

```
label,features
A,"0.123,0.456,...,0.789"   ← 63 floats
```

---

## 15. Environment & Setup

### Prerequisites

- Python 3.11+ (venv at `camsl-translator/venv/`)
- Node.js 18+
- A webcam

### First-time setup

```bash
# 1. Activate the Python venv (Windows)
.\venv\Scripts\Activate.ps1

# 2. Install Python dependencies
pip install -r requirements.txt

# 3. Extract landmarks from the raw dataset
python src/extract_landmarks.py

# 4. Train the alphabet model
python src/train.py
# → models/alphabet.keras  outputs/confusion_matrix.png

# 5. Export weights for TF.js
python scripts/convert_model.py
# → frontend/public/models/alphabet/group1-shard1of1.bin

# 6. Install frontend dependencies (also copies MediaPipe WASM)
cd frontend
npm install
# postinstall copies public/mediapipe/wasm/ automatically

# 7. Start the backend
cd ..
uvicorn backend.main:app --reload --port 8001

# 8. Start the frontend (separate terminal)
cd frontend
npm run dev
# → http://localhost:5173
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | *(required for chat)* | Gemini API key |
| `ALLOWED_ORIGIN` | `*` | CORS allowed origin (restrict in production) |
| `VITE_API_URL` | `""` (Vite proxy) | Backend base URL for production builds |

### Running Tests

```bash
# Activate venv first
pytest tests/ -v
# 18 tests: 9 word_builder + 9 landmarks
```

---

## 16. Known Limitations & Future Work

### Current Limitations

| Area | Limitation |
|---|---|
| **Alphabet scope** | 24 static letters only (A–Y excl J, Z). No motion signs. |
| **Lighting sensitivity** | Model accuracy drops in poor lighting — MediaPipe still detects but features shift |
| **Single hand** | Only one hand detected (`numHands: 1`). Two-handed signs not supported. |
| **Word-sign model** | `models/signs.keras` (LSTM + Attention) exists and is trained, but not integrated into the React frontend |
| **Grammar** | No sentence-level grammar (non-manual markers, facial expressions) — fingerspelling only |
| **Mobile** | Desktop-only in practice (webcam + full-height layout not optimised for mobile) |

### Technical Debt

| Item | Notes |
|---|---|
| J and Z | Would require optical flow or landmark velocity analysis over time |
| TF.js model loading | Custom binary loader is fragile — any architecture change in `train.py` requires updating `WEIGHT_SPECS` in `useInference.ts` manually |
| Auth tokens | Bearer token is sent in Zustand state but **not** in API request headers yet — backend `verify_token` is defined but auth is not enforced on contribution/practice routes |
| Retrain labels | If contributions introduce a new label letter the base model didn't have, `num_classes` changes and the binary layout changes — `useInference.ts` would fail |

### Future Work (Post-submission)

- **MediaPipe → browser fully**: Migrate face and pose landmarkers to browser WASM for the holistic 150-feature path, enabling word-sign recognition client-side
- **LSTM word-sign integration**: Load `signs.keras` in TF.js (requires LSTM + MultiHeadAttention layer support)
- **Avatar improvements**: Replace the FK wire-frame hand with a textured GLTF hand mesh, driven by the same FK landmark positions
- **Sentence grammar**: Add facial expression detection (eyebrow raise for questions) using the face landmarker
- **Mobile layout**: Responsive layout for tablet/phone use

---

*Documentation generated June 2026. Reflects codebase state after React migration, 3D hand model integration, and all audit fixes (Phase 1–3).*
