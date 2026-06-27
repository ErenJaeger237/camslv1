"""
record_signs.py — Step 4.5a of the pipeline.

Guided webcam tool for collecting hand-landmark sequences for word-sign training.
Each sign is captured as SEQUENCE_FRAMES consecutive MediaPipe landmark vectors.

Controls
--------
  UP / W      : previous sign in list
  DOWN / S    : next sign in list
  SPACE       : 3-second countdown then record one sequence
  D           : delete the last saved sample for the current sign
  Q / ESC     : quit

Saved to:  data/signs/<sign_name>/sample_NNN.npy
Each file : shape (SEQUENCE_FRAMES, 63) — float32 normalised landmarks
"""

import sys
import time
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from landmarks import HolisticExtractor, NUM_HOLISTIC_FEATURES

# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------
SEQUENCE_FRAMES   = 30      # frames captured per recording (~1 s at 30 fps)
COUNTDOWN_SEC     = 3       # pause before capture starts
MIN_HAND_RATIO    = 0.60    # discard sample if hand detected in fewer than this fraction of frames
CAMERA_ID         = 0

SIGNS = [
    "hello",    "thank_you", "yes",     "no",      "please",
    "help",     "sorry",     "goodbye", "sick",
    "eat",      "drink",     "school",  "good",    "bad",    "friend",
]
# Note: "water" and "name" (ASL initialized signs) replaced with "sick" and "school"
# which are more universal and present in CamSL / LSF-derived vocabularies.

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "signs"

# ---------------------------------------------------------------------------
# Data helpers
# ---------------------------------------------------------------------------

def sign_dir(sign: str) -> Path:
    d = DATA_DIR / sign
    d.mkdir(parents=True, exist_ok=True)
    return d

def sample_count(sign: str) -> int:
    d = DATA_DIR / sign
    return len(list(d.glob("sample_*.npy"))) if d.exists() else 0

def next_sample_path(sign: str) -> Path:
    return sign_dir(sign) / f"sample_{sample_count(sign):03d}.npy"

def delete_last(sign: str) -> bool:
    d = DATA_DIR / sign
    files = sorted(d.glob("sample_*.npy")) if d.exists() else []
    if not files:
        return False
    files[-1].unlink()
    return True

# ---------------------------------------------------------------------------
# Drawing helpers
# ---------------------------------------------------------------------------

ACCENT = (61, 219, 217)     # teal
GREEN  = (60, 200,  80)
RED    = (60,  80, 220)
YELLOW = (30, 200, 220)
WHITE  = (230, 230, 230)
GREY   = (100, 110, 130)
DARK   = (10,  14,  26)


def txt(frame, text, pos, color=WHITE, scale=0.52, bold=False):
    thick = 2 if bold else 1
    cv2.putText(frame, text, pos,
                cv2.FONT_HERSHEY_SIMPLEX, scale, color, thick, cv2.LINE_AA)


def draw_panel(frame: np.ndarray, idx: int) -> None:
    """Right-side panel: controls + sign list with sample counts."""
    h, w = frame.shape[:2]
    px = w - 220

    # Dark background strip
    overlay = frame.copy()
    cv2.rectangle(overlay, (px - 6, 0), (w, h), DARK, -1)
    cv2.addWeighted(overlay, 0.82, frame, 0.18, 0, frame)

    x = px
    txt(frame, "SIGN RECORDER", (x, 26), ACCENT, 0.52, bold=True)
    txt(frame, "W/S  navigate",  (x, 48), GREY, 0.40)
    txt(frame, "SPC  record",    (x, 62), GREY, 0.40)
    txt(frame, "D    delete last",(x, 76), GREY, 0.40)
    txt(frame, "Q    quit",       (x, 90), GREY, 0.40)
    cv2.line(frame, (px - 4, 104), (w, 104), (40, 50, 70), 1)

    txt(frame, "SIGNS  (need >= 15 each)", (x, 120), ACCENT, 0.38)
    for i, s in enumerate(SIGNS):
        n  = sample_count(s)
        col = ACCENT if i == idx else (GREEN if n >= 15 else WHITE)
        pre = ">" if i == idx else " "
        txt(frame, f"{pre} {s:<12} {n:>2}", (x, 140 + i * 19), col, 0.40)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    # CAP_DSHOW avoids the MSMF driver issue common on Windows
    cap = cv2.VideoCapture(CAMERA_ID, cv2.CAP_DSHOW)
    if not cap.isOpened():
        print("ERROR: Cannot open webcam.")
        return

    extractor   = HolisticExtractor()   # hand + face + pose = 150 features
    idx         = 0
    state       = "idle"       # "idle" | "countdown" | "recording"
    countdown_t = 0.0
    buffer: list = []

    # Transient status line
    status_text  = ""
    status_color = WHITE
    status_until = 0.0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame = cv2.flip(frame, 1)
        h, w  = frame.shape[:2]
        now   = time.perf_counter()
        sign  = SIGNS[idx]

        # ── MediaPipe ────────────────────────────────────────────────────────
        features, _, raw_lm = extractor.process(frame)

        # ── Draw landmarks ───────────────────────────────────────────────────
        if raw_lm:
            for lm in raw_lm:
                cx, cy = int(lm.x * w), int(lm.y * h)
                cv2.circle(frame, (cx, cy), 4, ACCENT, -1)

        # ── State machine ────────────────────────────────────────────────────
        if state == "countdown":
            remaining = COUNTDOWN_SEC - (now - countdown_t)
            if remaining <= 0:
                state  = "recording"
                buffer = []
            else:
                num_str = str(int(remaining) + 1)
                cv2.putText(frame, num_str,
                            (w // 2 - 60, h // 2 + 60),
                            cv2.FONT_HERSHEY_SIMPLEX, 6.0,
                            YELLOW, 10, cv2.LINE_AA)

        elif state == "recording":
            vec = features if features is not None else np.zeros(NUM_HOLISTIC_FEATURES, dtype=np.float32)
            buffer.append(vec)

            prog  = len(buffer) / SEQUENCE_FRAMES
            bar_w = int((w - 250) * prog)
            cv2.rectangle(frame, (10, h - 28), (w - 240, h - 10), (30, 40, 55), -1)
            cv2.rectangle(frame, (10, h - 28), (10 + bar_w, h - 10), GREEN, -1)
            txt(frame, f"Recording  {len(buffer)}/{SEQUENCE_FRAMES}",
                (10, h - 35), GREEN, 0.52, bold=True)

            if len(buffer) >= SEQUENCE_FRAMES:
                seq        = np.array(buffer, dtype=np.float32)   # (30, 63)
                hand_ratio = np.any(seq != 0, axis=1).mean()

                if hand_ratio >= MIN_HAND_RATIO:
                    np.save(next_sample_path(sign), seq)
                    status_text  = f"Saved! Total: {sample_count(sign)}"
                    status_color = GREEN
                else:
                    status_text  = "Too few hand frames — try again"
                    status_color = RED

                status_until = now + 2.2
                state        = "idle"

        # ── Panel & overlays ─────────────────────────────────────────────────
        draw_panel(frame, idx)

        # Current sign label (top-left)
        state_labels = {"idle": "READY",    "countdown": "GET READY!",
                        "recording": "RECORDING"}
        state_cols   = {"idle": GREEN,      "countdown": YELLOW,
                        "recording": RED}
        txt(frame, f"{sign.upper()}",
            (12, 32), WHITE, 0.75, bold=True)
        txt(frame, state_labels[state],
            (12, 56), state_cols[state], 0.58, bold=True)
        txt(frame, f"{sample_count(sign)} samples recorded",
            (12, 76), GREY, 0.44)

        if now < status_until:
            txt(frame, status_text, (12, h - 55), status_color, 0.52, bold=True)

        cv2.imshow("CAMSL — Sign Recorder  (Q to quit)", frame)

        # ── Keyboard ──────────────────────────────────────────────────────────
        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27):           # Q / ESC
            break
        elif key in (82, ord("w")):         # UP / W
            idx = (idx - 1) % len(SIGNS)
        elif key in (84, ord("s")):         # DOWN / S
            idx = (idx + 1) % len(SIGNS)
        elif key == ord(" ") and state == "idle":
            state       = "countdown"
            countdown_t = now
        elif key == ord("d") and state == "idle":
            if delete_last(sign):
                status_text  = "Last sample deleted"
                status_color = YELLOW
            else:
                status_text  = "No samples to delete"
                status_color = GREY
            status_until = now + 1.5

    cap.release()
    extractor.close()
    cv2.destroyAllWindows()

    print("\n── Recording summary ──────────────────")
    for s in SIGNS:
        n = sample_count(s)
        bar = "█" * min(n, 20)
        print(f"  {s:<12} {bar} {n}")
    print(f"\nData saved to  {DATA_DIR}")
    print("Run  python src/train_signs.py  when you have >= 15 samples per sign.")


if __name__ == "__main__":
    main()
