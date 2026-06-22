"""
app.py — PyWebView desktop shell for the CAMSL Translator.

Architecture:
  - CamSLAPI exposes Python methods to JavaScript via pywebview's JS bridge.
  - A background thread runs the webcam + MediaPipe + ML loop.  Each JPEG
    frame is pushed to MjpegServer; JS sets <img src=server.url> once and the
    browser streams natively — no Base64 encoding, no GC pressure.
  - get_state() returns only small text/number state (~1 KB) at ~30 fps.
  - All other state (letter, confidence, text, suggestions) is kept in the
    same dict and returned atomically.
  - Blocking operations (TTS, speech recognition) run in daemon threads so
    the JS Promise resolves when the operation completes without freezing
    the webcam loop.

Run:
    python src/app.py
"""

import base64
import csv
import json
import os
import random
import sqlite3
import sys
import threading
import time
from collections import deque
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
os.environ.setdefault("GLOG_minloglevel", "3")
os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")

import cv2
import numpy as np
import speech_recognition as sr
import webview

sys.path.insert(0, str(Path(__file__).resolve().parent))

from autocomplete import suggest
from database import LeitnerDB
from landmarks import HolisticExtractor, LandmarkExtractor, NUM_HOLISTIC_FEATURES
from mjpeg import MjpegServer
from recognizer import ALPHABET_LABELS, Recognizer
from text_to_sign import SIGNS_DIR, WHOLE_WORD_SIGNS
from tts import TTS
from word_builder import WordBuilder

# ---------------------------------------------------------------------------
# Paths & tunables
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
UI_HTML      = PROJECT_ROOT / "ui" / "index.html"
CONTRIBUTIONS_CSV = PROJECT_ROOT / "data" / "contributions" / "contributions.csv"
LEARNING_DB       = PROJECT_ROOT / "data" / "learning.db"
MODEL_OUT         = PROJECT_ROOT / "models" / "alphabet.keras"
SIGNS_MODEL_OUT   = PROJECT_ROOT / "models" / "signs.keras"
SIGNS_LABELS_OUT  = PROJECT_ROOT / "models" / "signs_labels.json"

SIGN_SEQUENCE_FRAMES      = 30     # must match record_signs.py / train_signs.py
SIGN_CONFIDENCE_THRESHOLD = 0.70   # minimum softmax confidence to report a sign

# Sign boundary detection — velocity-based onset/offset
# A sign is "in progress" when the wrist landmark moves faster than ONSET_THRESH.
# Classification fires only when movement drops back below OFFSET_THRESH after
# a period of motion (i.e. the hand has settled at a sign apex).
ONSET_THRESH   = 0.012   # normalised units/frame — hand starting to move
OFFSET_THRESH  = 0.008   # hand settling — trigger classification
MIN_SIGN_FRAMES = 8      # ignore micro-movements shorter than this many frames

WEBCAM_INDEX  = 0
FRAME_W       = 540
FRAME_H       = 405
JPEG_QUALITY  = 75
FPS_TARGET    = 30

HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (0, 9), (9, 10), (10, 11), (11, 12),
    (0, 13), (13, 14), (14, 15), (15, 16),
    (0, 17), (17, 18), (18, 19), (19, 20),
    (5, 9), (9, 13), (13, 17), (0, 17),
]
FINGERTIP_IDS = (4, 8, 12, 16, 20)


# ---------------------------------------------------------------------------
# JS-callable API
# ---------------------------------------------------------------------------

class CamSLAPI:
    """
    All public methods are callable from JavaScript as
        window.pywebview.api.method_name(args)
    and return a Promise that resolves to the method's return value.
    Return dicts / lists directly — pywebview serialises them to JSON.
    """

    def __init__(self):
        self._extractor          = LandmarkExtractor()    # hand-only, alphabet model
        self._holistic_extractor = HolisticExtractor()    # hand+face+pose, signs model
        self._recognizer = Recognizer()
        self._builder    = WordBuilder()
        self._tts        = TTS()

        self._mode = "sign2text"
        self._lock = threading.Lock()

        # Word-sign LSTM model (optional — only loaded if signs.keras exists)
        self._signs_model  = None
        self._signs_labels = []
        self._signs_mode   = False
        self._signs_buffer = deque(maxlen=SIGN_SEQUENCE_FRAMES)
        self._load_signs_model()

        # Shared state — written by webcam thread, read by JS on every poll.
        self._state = {
            "frame_b64":    "",
            "letter":       None,
            "confidence":   0.0,
            "open_palm":    False,
            "has_hand":     False,
            "fps":          0.0,
            "status":       "Starting...",
            "error":        False,
            "stability":    0.0,
            "current_word": "",
            "current_text": "",
            "suggestions":  [],
            # Word-sign recognition
            "signs_mode":          False,
            "signs_model_loaded":  False,
            "current_sign":        None,
            "sign_confidence":     0.0,
            # Background retraining status
            "training_status": "idle",
            "training_epoch":  "Epoch 0/0",
            "training_loss":   0.0,
            "training_val_acc":0.0,
            "training_results": None,
        }

        # Spaced repetition — delegated to LeitnerDB
        self._db = LeitnerDB(LEARNING_DB, ALPHABET_LABELS)
        self._db.init()
        self._recent_practice: list[str] = []

        # Practice scores are kept in Python so they survive mode switches.
        self._practice_letter = self._db.select_next_letter(self._recent_practice)
        self._p_correct = 0
        self._p_total   = 0
        self._p_streak  = 0

        # Canonical 3-D hand poses for each letter — computed once from
        # features.csv and cached to ui/poses.json for instant future loads.
        self._canonical_poses = self._load_canonical_poses()

        # Latest raw frame shared between capture and ML threads.
        # Protected by _frame_lock (separate from _lock to avoid contention).
        self._raw_frame:  np.ndarray | None = None
        self._raw_lm                        = None   # cached landmarks for overlay
        self._last_features                 = None   # latest normalized vector
        self._frame_id   = 0     # incremented by capture thread on every new frame
        self._ml_frame_id = -1   # last frame ID processed by ML thread
        self._frame_lock = threading.Lock()

        # MJPEG server: JS sets <img src=url> once; browser streams natively.
        self._mjpeg = MjpegServer()

        self._running = True
        threading.Thread(target=self._capture_loop, daemon=True).start()
        threading.Thread(target=self._ml_loop,      daemon=True).start()

    # -----------------------------------------------------------------------
    # Word-sign model helpers
    # -----------------------------------------------------------------------

    def _load_signs_model(self) -> None:
        """Load the LSTM word-sign model if signs.keras + signs_labels.json exist."""
        try:
            if SIGNS_MODEL_OUT.exists() and SIGNS_LABELS_OUT.exists():
                import tensorflow as tf
                self._signs_model  = tf.keras.models.load_model(str(SIGNS_MODEL_OUT))
                with open(SIGNS_LABELS_OUT) as f:
                    self._signs_labels = json.load(f)
                with self._lock:
                    self._state["signs_model_loaded"] = True
                print(f"[Signs] Loaded model ({len(self._signs_labels)} signs).")
            else:
                print("[Signs] No signs model found — word-sign mode disabled until trained.")
        except Exception as e:
            print(f"[Signs] Could not load signs model: {e}")

    def toggle_signs_mode(self) -> dict:
        """
        Toggle between letter-spelling mode and word-sign recognition mode.
        Returns {"signs_mode": bool, "signs_model_loaded": bool}.
        Called from JS as window.pywebview.api.toggle_signs_mode().
        """
        if self._signs_model is None:
            return {"signs_mode": False, "signs_model_loaded": False,
                    "error": "No signs model — run: python src/train_signs.py"}
        self._signs_mode = not self._signs_mode
        self._signs_buffer.clear()
        with self._lock:
            self._state["signs_mode"]      = self._signs_mode
            self._state["current_sign"]    = None
            self._state["sign_confidence"] = 0.0
        return {"signs_mode": self._signs_mode, "signs_model_loaded": True}

    # -----------------------------------------------------------------------
    # Polled by JS every ~33 ms
    # -----------------------------------------------------------------------

    def get_stream_url(self) -> str:
        """Return the MJPEG stream URL for JS to set as <img src> once on startup."""
        return self._mjpeg.url

    def get_state(self):
        with self._lock:
            return dict(self._state)   # shallow copy is safe — all primitives

    # -----------------------------------------------------------------------
    # Sign → Text
    # -----------------------------------------------------------------------

    def set_mode(self, mode: str):
        self._mode = mode

    def speak(self):
        text = self._builder.current_text + self._builder.current_word
        threading.Thread(target=self._tts.speak, args=(text,), daemon=True).start()

    def speak_text(self, text: str):
        """Speak the given text using the offline TTS thread."""
        threading.Thread(target=self._tts.speak, args=(text,), daemon=True).start()

    def clear_text(self):
        self._builder.clear()
        self._push_builder_state()

    def backspace(self):
        self._builder.backspace()
        self._push_builder_state()

    def accept_suggestion(self, word: str):
        self._builder.accept_autocomplete(word)
        self._push_builder_state()

    # -----------------------------------------------------------------------
    # Text → Sign
    # -----------------------------------------------------------------------

    def get_signs_for_text(self, text: str):
        """
        Return [{char, b64}] for each sign in the text.
        Whole-word signs (HELLO, etc.) are returned as one entry.
        Characters with no image asset are included with b64: null so the
        UI can show a placeholder.
        """
        results = []
        for token in text.upper().split():
            if token in WHOLE_WORD_SIGNS:
                img = SIGNS_DIR / f"{token}.png"
                if img.exists():
                    results.append({
                        "char": token,
                        "b64": base64.b64encode(img.read_bytes()).decode(),
                    })
                    continue
            for ch in token:
                if not ch.isalpha():
                    continue
                img = SIGNS_DIR / f"{ch}.png"
                results.append({
                    "char": ch,
                    "b64": base64.b64encode(img.read_bytes()).decode() if img.exists() else None,
                })
        return results

    def start_listening(self):
        """
        Block until one spoken phrase is recorded and transcribed.
        Returns {text} on success or {error} on failure.
        Runs inside pywebview's thread pool so the webcam loop is unaffected.
        """
        rec = sr.Recognizer()
        rec.energy_threshold = 300
        rec.pause_threshold  = 0.8
        try:
            with sr.Microphone() as source:
                rec.adjust_for_ambient_noise(source, duration=0.5)
                audio = rec.listen(source, phrase_time_limit=10)
            text = rec.recognize_google(audio)
            return {"text": text}
        except sr.UnknownValueError:
            return {"error": "Could not understand — please try again."}
        except Exception as exc:
            return {"error": str(exc)}

    # -----------------------------------------------------------------------
    # Dataset Builder
    # -----------------------------------------------------------------------

    def save_contribution(self, label: str):
        """
        Append the most recent high-quality landmark vector to the 
        contributions CSV. Returns {success, count} or {error}.
        """
        with self._frame_lock:
            features = self._last_features

        if features is None:
            return {"error": "No hand detected. Please position your hand in frame."}

        try:
            CONTRIBUTIONS_CSV.parent.mkdir(parents=True, exist_ok=True)
            needs_header = not CONTRIBUTIONS_CSV.exists()

            with open(CONTRIBUTIONS_CSV, "a", newline="") as f:
                writer = csv.writer(f)
                if needs_header:
                    # Write column names matching features.csv so the two files
                    # can be concatenated directly for retraining.
                    header = [f"feature_{i}" for i in range(63)] + ["label"]
                    writer.writerow(header)
                writer.writerow(list(features) + [label.upper()])

            return {"success": True, "label": label.upper()}
        except Exception as e:
            return {"error": str(e)}

    def get_contribution_counts(self):
        """Return a dictionary of {letter: count} for all samples in contributions.csv."""
        counts = {ltr: 0 for ltr in ALPHABET_LABELS}
        if not CONTRIBUTIONS_CSV.exists():
            return counts
        try:
            with open(CONTRIBUTIONS_CSV, "r", newline="") as f:
                reader = csv.reader(f)
                next(reader, None) # skip header
                for row in reader:
                    if row:
                        label = row[-1].upper()
                        if label in counts:
                            counts[label] += 1
        except Exception as e:
            print(f"[Dataset] Error reading contribution counts: {e}")
        return counts

    def delete_last_contribution(self):
        """
        Delete the last contribution sample from contributions.csv.
        Returns {"success": True, "message": "...", "counts": {...}} or {"error": "..."}.
        """
        if not CONTRIBUTIONS_CSV.exists():
            return {"error": "No contributions saved yet."}
        try:
            with open(CONTRIBUTIONS_CSV, "r", newline="") as f:
                rows = list(csv.reader(f))
            
            if len(rows) <= 1:
                CONTRIBUTIONS_CSV.unlink()
                return {"success": True, "message": "All contributions deleted.", "counts": self.get_contribution_counts()}
            
            deleted = rows.pop()
            with open(CONTRIBUTIONS_CSV, "w", newline="") as f:
                writer = csv.writer(f)
                writer.writerows(rows)
                
            return {
                "success": True,
                "message": f"Deleted last sample for letter '{deleted[-1]}'.",
                "counts": self.get_contribution_counts()
            }
        except Exception as e:
            return {"error": f"Failed to delete last sample: {str(e)}"}

    def trigger_retraining(self):
        """
        Trigger background model retraining on the combined dataset.
        Returns {"success": True} or {"error": "..."}.
        """
        with self._lock:
            if self._state.get("training_status") in ("merging", "training"):
                return {"error": "Retraining is already in progress."}
            self._state["training_status"] = "merging"
            self._state["training_epoch"] = "Epoch 0/0"
            self._state["training_loss"] = 0.0
            self._state["training_val_acc"] = 0.0
            self._state["training_results"] = None
            
        threading.Thread(target=self._run_retraining_thread, daemon=True).start()
        return {"success": True}

    def _run_retraining_thread(self):
        """
        Background thread worker for model retraining and dynamic reloading.

        OOM mitigations applied:
          1. TF thread limits prevent retraining from starving the inference threads.
          2. MAX_RETRAIN_SAMPLES caps the dataset so memory stays bounded.
          3. Intermediate DataFrames are deleted immediately after feature extraction.
          4. keras.backend.clear_session() is NOT called — it would destroy the
             already-loaded inference model's Keras graph, causing silent corruption.
        """
        MAX_RETRAIN_SAMPLES = 8_000   # cap to avoid OOM while webcam + MediaPipe run

        try:
            import gc

            import pandas as pd
            from sklearn.model_selection import train_test_split
            from sklearn.preprocessing import LabelEncoder
            import tensorflow as tf
            from tensorflow import keras

            # Limit TF to 2 threads so retraining doesn't starve the webcam/ML loops
            tf.config.threading.set_inter_op_parallelism_threads(2)
            tf.config.threading.set_intra_op_parallelism_threads(2)

            from train import (
                build_mlp, augment, TEST_SIZE, VAL_SIZE, RANDOM_STATE,
                EPOCHS, BATCH_SIZE, LEARNING_RATE, AUGMENT_COPIES, AUGMENT_NOISE,
                EARLY_STOP_PATIENCE,
            )

            base_csv    = PROJECT_ROOT / "data" / "features.csv"
            contrib_csv = CONTRIBUTIONS_CSV

            if not base_csv.exists():
                raise FileNotFoundError(f"Base features.csv not found at {base_csv}")

            # 1. Merge and cap dataset size
            with self._lock:
                self._state["training_status"] = "merging"

            df_base = pd.read_csv(base_csv)
            if contrib_csv.exists():
                df_contrib = pd.read_csv(contrib_csv)
                df_merged = pd.concat([df_base, df_contrib], ignore_index=True)
                del df_contrib
            else:
                df_merged = df_base
            del df_base

            if len(df_merged) > MAX_RETRAIN_SAMPLES:
                df_merged = df_merged.sample(
                    n=MAX_RETRAIN_SAMPLES, random_state=RANDOM_STATE
                ).reset_index(drop=True)
                print(f"[Retrain] Dataset capped to {MAX_RETRAIN_SAMPLES} samples to limit memory.")

            X = df_merged.drop(columns=["label"]).values.astype(np.float32)
            le = LabelEncoder()
            y  = le.fit_transform(df_merged["label"].values)
            class_names = list(le.classes_)
            num_classes  = len(class_names)
            del df_merged
            gc.collect()

            # Split (same logic as train.py)
            val_fraction = VAL_SIZE / (1.0 - TEST_SIZE)
            X_tv, X_test, y_tv, y_test = train_test_split(
                X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y
            )
            del X, y
            X_train, X_val, y_train, y_val = train_test_split(
                X_tv, y_tv, test_size=val_fraction, random_state=RANDOM_STATE, stratify=y_tv
            )
            del X_tv, y_tv

            # Augment training set
            X_train_aug, y_train_aug = augment(X_train, y_train, AUGMENT_COPIES, AUGMENT_NOISE)
            del X_train, y_train
            gc.collect()

            # Snapshot old model accuracy before overwriting
            old_test_acc = 0.0
            if MODEL_OUT.exists():
                try:
                    old_model = keras.models.load_model(str(MODEL_OUT))
                    old_test_acc = old_model.evaluate(X_test, y_test, verbose=0)[1]
                    del old_model
                    gc.collect()
                except Exception as exc:
                    print(f"[Retrain] Could not evaluate old model: {exc}")

            # 2. Train
            with self._lock:
                self._state["training_status"] = "training"

            outer_self = self

            class StatusCallback(keras.callbacks.Callback):
                def on_epoch_end(self, epoch, logs=None):
                    logs = logs or {}
                    with outer_self._lock:
                        outer_self._state["training_epoch"]   = f"Epoch {epoch + 1}/{EPOCHS}"
                        outer_self._state["training_loss"]    = round(float(logs.get("loss", 0.0)), 4)
                        outer_self._state["training_val_acc"] = round(float(logs.get("val_accuracy", 0.0)), 4)

            model = build_mlp(X_train_aug.shape[1], num_classes)
            model.compile(
                optimizer=keras.optimizers.Adam(LEARNING_RATE),
                loss="sparse_categorical_crossentropy",
                metrics=["accuracy"],
            )

            model.fit(
                X_train_aug, y_train_aug,
                validation_data=(X_val, y_val),
                epochs=EPOCHS,
                batch_size=BATCH_SIZE,
                callbacks=[
                    StatusCallback(),
                    keras.callbacks.EarlyStopping(
                        monitor="val_accuracy",
                        patience=EARLY_STOP_PATIENCE,
                        restore_best_weights=True,
                        verbose=0,
                    ),
                    keras.callbacks.ReduceLROnPlateau(
                        monitor="val_loss", factor=0.5, patience=4, verbose=0,
                    ),
                ],
                verbose=0,
            )
            del X_train_aug, y_train_aug, X_val, y_val
            gc.collect()

            new_test_acc = model.evaluate(X_test, y_test, verbose=0)[1]
            del X_test, y_test

            MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
            model.save(str(MODEL_OUT))
            del model
            gc.collect()

            # Hot-reload inference model
            self._recognizer.load_model(MODEL_OUT)

            with self._lock:
                self._state["training_status"]  = "finished"
                self._state["training_results"] = {
                    "old_acc": round(float(old_test_acc), 4),
                    "new_acc": round(float(new_test_acc), 4),
                    "delta":   round(float(new_test_acc - old_test_acc), 4),
                }

        except Exception as e:
            print(f"[Retrain] Background retraining failed: {e}")
            with self._lock:
                self._state["training_status"] = "error"
                self._state["status"]          = f"Retraining failed: {str(e)}"

    def send_chat_message(self, message: str, history: list, api_key: str = None):
        """
        Send a conversation history to the Gemini API and return the response text.
        history is a list of {"role": "user"|"model", "text": "..."} dicts.
        """
        key = api_key or os.environ.get("GEMINI_API_KEY")
        if not key:
            return {"error": "GEMINI_API_KEY_MISSING"}

        # Sanitise inputs — prevent prompt injection via crafted history payloads
        if not isinstance(message, str) or not isinstance(history, list):
            return {"error": "Invalid input types."}
        message = message[:1000].strip()        # cap message length
        if not message:
            return {"error": "Empty message."}

        import urllib.request
        import urllib.error

        safe_history = []
        for turn in history[-20:]:              # cap context window to last 20 turns
            if not isinstance(turn, dict):
                continue
            role = "user" if turn.get("role") == "user" else "model"
            text = str(turn.get("text", ""))[:2000]   # cap individual turn length
            safe_history.append({"role": role, "parts": [{"text": text}]})

        contents = safe_history + [{"role": "user", "parts": [{"text": message}]}]

        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={key}"
        payload = {
            "contents": contents,
            "systemInstruction": {
                "parts": [{"text": "You are a helpful conversational AI assistant for a deaf user who is signing letters or words. Your replies must be in plain, simple, and extremely concise English. Avoid long-winded paragraphs. Keep responses under 3 sentences where possible. Focus on directness and readability."}]
            }
        }
        
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=12) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                
            candidates = res_data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    reply = parts[0].get("text", "")
                    return {"text": reply}
            
            return {"error": "Received empty or unexpected response structure from Gemini API."}
        except urllib.error.HTTPError as e:
            try:
                err_body = e.read().decode("utf-8")
                err_json = json.loads(err_body)
                err_msg = err_json.get("error", {}).get("message", str(e))
            except Exception:
                err_msg = str(e)
            return {"error": f"Gemini API Error: {err_msg}"}
        except Exception as e:
            return {"error": f"Network / Connection error: {str(e)}"}

    def _select_next_leitner_letter(self) -> str:
        """Delegate to LeitnerDB and maintain the recent-practice rolling buffer."""
        chosen = self._db.select_next_letter(self._recent_practice)
        self._recent_practice.append(chosen)
        if len(self._recent_practice) > 4:
            self._recent_practice.pop(0)
        return chosen

    # -----------------------------------------------------------------------
    # Practice
    # -----------------------------------------------------------------------

    def get_practice_initial(self):
        """Called once at startup to seed the practice UI."""
        return self._practice_dict()

    def record_practice_result(self, correct: bool):
        if correct:
            self._p_correct += 1
            self._p_streak  += 1
        else:
            self._p_streak = 0
        self._p_total += 1

        # Update Leitner box and scheduling in database
        try:
            self._db.update(self._practice_letter, correct)
        except Exception as e:
            print(f"[Practice DB] Error updating Leitner: {e}")

        return {
            "correct": self._p_correct,
            "total":   self._p_total,
            "streak":  self._p_streak,
            "mastery": self._db.overall_mastery(),
        }

    def next_practice_letter(self):
        self._practice_letter = self._select_next_leitner_letter()
        return self._practice_dict()

    def _practice_dict(self):
        img = PROJECT_ROOT / "assets" / "signs" / f"{self._practice_letter}.png"
        ref_b64 = None
        if img.exists():
            try:
                ref_b64 = base64.b64encode(img.read_bytes()).decode()
            except Exception:
                pass
        return {
            "letter":  self._practice_letter,
            "ref_b64": ref_b64,
            "correct": self._p_correct,
            "total":   self._p_total,
            "streak":  self._p_streak,
            "mastery": self._db.overall_mastery(),
        }

    # -----------------------------------------------------------------------
    # 3-D canonical poses
    # -----------------------------------------------------------------------

    def get_canonical_poses(self):
        """Return {letter: [[x,y,z]*21]} for Three.js practice renderer."""
        return self._canonical_poses

    def _load_canonical_poses(self) -> dict:
        import pandas as pd
        poses_json = PROJECT_ROOT / "ui" / "poses.json"
        if poses_json.exists():
            return json.loads(poses_json.read_text(encoding="utf-8"))

        csv_path = PROJECT_ROOT / "data" / "features.csv"
        if not csv_path.exists():
            return {}

        df   = pd.read_csv(csv_path)
        cols = [c for c in df.columns if c != "label"]   # exactly 63 feature cols
        out  = {}
        for label, grp in df.groupby("label"):
            mean = grp[cols].mean().values          # (63,) mean landmark coords
            out[str(label)] = mean.reshape(21, 3).tolist()

        poses_json.parent.mkdir(parents=True, exist_ok=True)
        poses_json.write_text(json.dumps(out), encoding="utf-8")
        return out

    # -----------------------------------------------------------------------
    # Internal helpers
    # -----------------------------------------------------------------------

    def _push_builder_state(self):
        """Sync word-builder state into the shared dict after a UI action."""
        prefix = self._builder.current_word
        with self._lock:
            self._state["current_word"] = self._builder.current_word
            self._state["current_text"] = self._builder.current_text
            self._state["stability"]    = float(self._builder.buffer_fill)
            self._state["suggestions"]  = suggest(prefix) if prefix else []

    def _capture_loop(self):
        """
        Thread 1 — Display.
        Reads webcam frames at FPS_TARGET, draws the skeleton using the most
        recent landmarks from the ML thread, JPEG-encodes, and stores the
        base64 string in the shared state.  MediaPipe is NOT called here, so
        this thread is never blocked by inference and stays at full speed.
        """
        cap = cv2.VideoCapture(WEBCAM_INDEX)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH,  640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

        if not cap.isOpened():
            with self._lock:
                self._state["status"] = "Cannot open webcam"
                self._state["error"]  = True
            return

        with self._lock:
            self._state["status"] = "Camera ready"

        fps_frames  = 0
        fps_timer   = time.perf_counter()
        current_fps = 0.0
        t_last      = time.perf_counter()

        while self._running:
            ok, frame = cap.read()
            if not ok:
                time.sleep(0.05)
                continue

            frame = cv2.flip(frame, 1)

            # Share raw frame with the ML thread (copy avoids data races)
            with self._frame_lock:
                self._raw_frame = frame.copy()
                self._frame_id += 1      # signal ML thread that a new frame is ready
                raw_lm = self._raw_lm   # read latest landmarks from ML thread

            # Skeleton overlay using last-known landmarks
            if raw_lm:
                h, w = frame.shape[:2]
                pts = [(int(lm.x * w), int(lm.y * h)) for lm in raw_lm]
                for a, b in HAND_CONNECTIONS:
                    cv2.line(frame, pts[a], pts[b], (80, 200, 120), 2, cv2.LINE_AA)
                for i, (x, y) in enumerate(pts):
                    tip   = i in FINGERTIP_IDS
                    color = (0, 210, 255) if tip else (255, 255, 255)
                    r     = 5 if tip else 3
                    cv2.circle(frame, (x, y), r, color, -1, cv2.LINE_AA)
                    cv2.circle(frame, (x, y), r, (0, 0, 0), 1, cv2.LINE_AA)

            # FPS measured on the display thread (represents what JS actually sees)
            fps_frames += 1
            now = time.perf_counter()
            if now - fps_timer >= 1.0:
                current_fps = fps_frames / (now - fps_timer)
                fps_frames  = 0
                fps_timer   = now

            small = cv2.resize(frame, (FRAME_W, FRAME_H))
            _, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
            # Push binary JPEG directly to MJPEG server — no Base64, no GC pressure
            self._mjpeg.push_frame(buf.tobytes())

            with self._lock:
                if current_fps > 0:
                    self._state["fps"] = round(current_fps, 1)

            elapsed = time.perf_counter() - t_last
            time.sleep(max(0.0, 1.0 / FPS_TARGET - elapsed))
            t_last = time.perf_counter()

        cap.release()

    def _ml_loop(self):
        """
        Thread 2 — Inference.
        Continuously picks up the latest raw frame from the capture thread,
        runs MediaPipe + Keras classifier, then writes results to shared state.

        Sign boundary detection (word-sign mode):
          The wrist landmark velocity is tracked frame-to-frame in normalised
          coordinates.  When the hand accelerates above ONSET_THRESH the system
          enters 'moving' state and starts buffering frames.  When it then drops
          below OFFSET_THRESH (hand has settled at a sign apex) the buffer is
          classified once — not on every arbitrary window.  This eliminates
          mid-transition noise and lets the model see a clean, complete gesture.
        """
        last_word      = ""
        prev_wrist     = None        # wrist (x,y) from previous frame for velocity
        sign_moving    = False       # True while hand is in motion
        move_frames    = 0           # consecutive frames above ONSET_THRESH

        while self._running:
            with self._frame_lock:
                frame    = self._raw_frame
                frame_id = self._frame_id

            if frame is None:
                time.sleep(0.01)
                continue

            # Skip if the capture thread hasn't produced a new frame yet
            if frame_id == self._ml_frame_id:
                time.sleep(0.002)
                continue
            self._ml_frame_id = frame_id

            features, is_open_palm, raw_lm = self._extractor.process(frame)

            letter, confidence = None, 0.0
            if features is not None and not is_open_palm:
                letter, confidence = self._recognizer.predict(features)

            # Cache landmarks so the capture thread can draw the skeleton
            with self._frame_lock:
                self._raw_lm = raw_lm
                self._last_features = features

            # ── Word-sign recognition with boundary detection ─────────────
            current_sign = None
            sign_conf    = 0.0
            if self._signs_mode and self._signs_model is not None:
                # Use holistic extractor (hand+face+pose) for richer features
                h_features, _, _ = self._holistic_extractor.process(frame)
                vec = h_features if h_features is not None else np.zeros(NUM_HOLISTIC_FEATURES, dtype=np.float32)

                # Wrist velocity from the hand portion of the holistic vector (first 2 values).
                wrist_xy = vec[0:2].copy()
                velocity = float(np.linalg.norm(wrist_xy - prev_wrist)) if prev_wrist is not None else 0.0
                prev_wrist = wrist_xy

                if velocity > ONSET_THRESH:
                    # Hand is moving — accumulate frames
                    move_frames += 1
                    if not sign_moving and move_frames >= 2:
                        sign_moving = True
                        self._signs_buffer.clear()   # fresh buffer for this gesture
                    if sign_moving:
                        self._signs_buffer.append(vec)
                else:
                    if sign_moving and velocity < OFFSET_THRESH:
                        # Hand has just settled — classify if we collected enough
                        if len(self._signs_buffer) >= MIN_SIGN_FRAMES:
                            # Pad or truncate to SIGN_SEQUENCE_FRAMES
                            buf = list(self._signs_buffer)
                            while len(buf) < SIGN_SEQUENCE_FRAMES:
                                buf.append(buf[-1])          # repeat last frame
                            buf = buf[:SIGN_SEQUENCE_FRAMES]
                            seq   = np.array(buf, dtype=np.float32)[np.newaxis]
                            probs = self._signs_model.predict(seq, verbose=0)[0]
                            idx   = int(np.argmax(probs))
                            sign_conf = float(probs[idx])
                            if sign_conf >= SIGN_CONFIDENCE_THRESHOLD:
                                current_sign = self._signs_labels[idx]
                        sign_moving = False
                        move_frames = 0
                    elif not sign_moving:
                        move_frames = 0

            # ── Word-builder (letter mode, sign2text only) ─────────────────
            suggs = None
            if self._mode == "sign2text" and not self._signs_mode:
                effective = None if is_open_palm else letter
                self._builder.update(effective, confidence)
                cur_word = self._builder.current_word
                if cur_word != last_word:
                    last_word = cur_word
                    suggs = suggest(cur_word) if cur_word else []

            with self._lock:
                self._state.update({
                    "letter":          letter,
                    "confidence":      round(float(confidence), 4),
                    "open_palm":       bool(is_open_palm),
                    "has_hand":        raw_lm is not None,
                    "stability":       float(self._builder.buffer_fill),
                    "current_word":    self._builder.current_word,
                    "current_text":    self._builder.current_text,
                    "current_sign":    current_sign,
                    "sign_confidence": round(sign_conf, 4),
                    "sign_moving":     sign_moving,
                })
                if suggs is not None:
                    self._state["suggestions"] = suggs

            # No sleep — run as fast as the CPU allows

    def shutdown(self):
        self._running = False
        self._extractor.close()
        self._holistic_extractor.close()
        self._mjpeg.stop()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    if not UI_HTML.exists():
        raise FileNotFoundError(
            f"UI file not found at {UI_HTML}\n"
            "Expected: camsl-translator/ui/index.html"
        )

    api = CamSLAPI()
    window = webview.create_window(   # noqa: F841  (used by webview.start)
        title="CAMSL Translator",
        url=str(UI_HTML),
        js_api=api,
        width=1300,
        height=800,
        min_size=(1100, 680),
        background_color="#07090f",
    )
    webview.start(debug=False)
    api.shutdown()


if __name__ == "__main__":
    main()
