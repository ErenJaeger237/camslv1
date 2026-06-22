"""
landmarks.py — MediaPipe HandLandmarker wrapper for real-time webcam inference.

Uses VIDEO mode so MediaPipe tracks the hand between consecutive frames instead
of running full detection from scratch each time.  This gives:
  - Smoother, less jittery landmark positions
  - Faster inference (tracking is cheaper than cold detection)
  - Better prediction stability for the letter classifier

MediaPipe receives a 320×240 downscale of the frame.  The landmark coordinates
are normalised (0–1) relative to the image so no accuracy is lost.  The raw
landmark objects returned to the caller still work correctly for skeleton overlay
because they are multiplied by the full-frame pixel dimensions in app.py.
"""

import time
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

PROJECT_ROOT      = Path(__file__).resolve().parent.parent
MODEL_PATH        = PROJECT_ROOT / "models" / "hand_landmarker.task"
FACE_MODEL_PATH   = PROJECT_ROOT / "models" / "face_landmarker.task"
POSE_MODEL_PATH   = PROJECT_ROOT / "models" / "pose_landmarker_lite.task"

# Input resolution fed to MediaPipe — smaller = faster inference.
# Landmark x/y values are already normalised 0–1, so accuracy is unaffected.
MP_W, MP_H = 320, 240

FINGERTIP_IDS = [8, 12, 16, 20]
PIP_IDS       = [6, 10, 14, 18]
THUMB_TIP_ID  = 4
THUMB_IP_ID   = 3

NUM_FEATURES = 21 * 3   # 63  (hand-only, used by alphabet model)

# ── Holistic feature configuration ─────────────────────────────────────────
# Linguistically relevant face landmarks (from MediaPipe's 478-point mesh).
# Selected to capture eyebrow movement (question type / negation grammar),
# eye openness, mouth shape (mouth morphemes), and head orientation.
FACE_KEY_LMS = [
    55, 107, 46,      # left eyebrow: inner, center, outer
    285, 336, 276,    # right eyebrow: inner, center, outer
    159, 145,         # left eye: top, bottom
    386, 374,         # right eye: top, bottom
    61, 291, 13, 14,  # mouth: corners + upper/lower lip center
    10, 152,          # head: top, chin  (for nod detection)
    234, 454,         # head: left, right temples (for head-shake detection)
    4, 1,             # nose tip + base
]  # 20 landmarks × 3 = 60 features

# Upper-body pose landmarks (MediaPipe's 33-point skeleton).
# Captures shoulder orientation and arm elevation without full-body noise.
POSE_KEY_LMS = [
    0,        # nose (head position)
    11, 12,   # shoulders
    13, 14,   # elbows
    15, 16,   # wrists (coarse; fine detail comes from hand landmarker)
    23, 24,   # hips (trunk orientation anchor)
]  # 9 landmarks × 3 = 27 features

NUM_FACE_FEATURES   = len(FACE_KEY_LMS) * 3   # 60
NUM_POSE_FEATURES   = len(POSE_KEY_LMS) * 3   # 27
NUM_HOLISTIC_FEATURES = NUM_FEATURES + NUM_FACE_FEATURES + NUM_POSE_FEATURES  # 150


class LandmarkExtractor:
    """
    Wraps MediaPipe HandLandmarker in VIDEO mode for frame-by-frame inference.

    VIDEO mode builds a short temporal context across consecutive calls, which
    produces smoother landmark trajectories and faster hand tracking compared
    to IMAGE (stateless) mode.

    Must be called from a single thread in chronological order — VIDEO mode
    requires strictly increasing timestamps.
    """

    def __init__(self, model_path: Path = MODEL_PATH):
        base_opts = mp_python.BaseOptions(model_asset_path=str(model_path))
        opts = mp_vision.HandLandmarkerOptions(
            base_options=base_opts,
            running_mode=mp_vision.RunningMode.VIDEO,
            num_hands=1,
            min_hand_detection_confidence=0.5,
            min_hand_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self._landmarker = mp_vision.HandLandmarker.create_from_options(opts)
        self._t0 = time.perf_counter()     # reference for monotonic timestamps

    def process(self, frame_bgr: np.ndarray) -> tuple:
        """
        Run hand landmark detection on one BGR webcam frame.

        Returns
        -------
        features : np.ndarray (63,) or None
        is_open_palm : bool
        raw_landmarks : list or None  — passed to the GUI for skeleton overlay
        """
        # Strictly increasing ms timestamp required by VIDEO mode
        timestamp_ms = int((time.perf_counter() - self._t0) * 1000)

        small = cv2.resize(frame_bgr, (MP_W, MP_H))
        rgb   = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        result = self._landmarker.detect_for_video(mp_image, timestamp_ms)

        if not result.hand_landmarks:
            return None, False, None

        lms      = result.hand_landmarks[0]
        features = self._normalise(lms)
        open_palm = self._is_open_palm(lms)
        return features, open_palm, lms

    def _normalise(self, landmarks) -> np.ndarray:
        """
        Translate so wrist (landmark 0) is the origin; scale by the
        wrist-to-middle-finger-MCP (landmark 9) distance.

        Must match the normalisation in extract_landmarks.py exactly.
        """
        coords = np.array([[lm.x, lm.y, lm.z] for lm in landmarks])
        coords -= coords[0]
        scale   = np.linalg.norm(coords[9])
        if scale > 0:
            coords /= scale
        return coords.flatten().astype(np.float32)

    def _is_open_palm(self, landmarks) -> bool:
        """All four fingers and thumb extended — used as the SPACE trigger."""
        fingers_open = all(
            landmarks[tip].y < landmarks[pip].y
            for tip, pip in zip(FINGERTIP_IDS, PIP_IDS)
        )
        thumb_open = landmarks[THUMB_TIP_ID].y < landmarks[THUMB_IP_ID].y
        return fingers_open and thumb_open

    def close(self) -> None:
        self._landmarker.close()

    def __enter__(self):  return self
    def __exit__(self, *_): self.close()


class HolisticExtractor:
    """
    Extended landmark extractor that combines hand + face + pose features.

    Feature layout (150 floats per frame):
      [  0: 63] — hand landmarks, normalised (same as LandmarkExtractor)
      [ 63:123] — 20 key face landmarks, centred on nose tip
      [123:150] — 9 upper-body pose landmarks, centred on shoulder midpoint

    The richer 150-feature representation captures:
      - Hand shape (fingerspelling, handshape)
      - Facial grammar (eyebrow raise/furrow = question type, negation)
      - Mouth morphemes (mouth shape distinguishes near-homophones)
      - Head movement (nod = YES, shake = NO, tilt = rhetorical question)
      - Arm/shoulder position (body-anchored signs like SORRY, PLEASE)

    Falls back to hand-only (zeros for face/pose) if models are not found.
    Run  python src/download_models.py  to download the required .task files.
    """

    def __init__(self):
        base_opts_hand = mp_python.BaseOptions(model_asset_path=str(MODEL_PATH))
        self._hand = mp_vision.HandLandmarker.create_from_options(
            mp_vision.HandLandmarkerOptions(
                base_options=base_opts_hand,
                running_mode=mp_vision.RunningMode.VIDEO,
                num_hands=1,
                min_hand_detection_confidence=0.5,
                min_hand_presence_confidence=0.5,
                min_tracking_confidence=0.5,
            )
        )

        self._face = None
        self._pose = None

        if FACE_MODEL_PATH.exists():
            self._face = mp_vision.FaceLandmarker.create_from_options(
                mp_vision.FaceLandmarkerOptions(
                    base_options=mp_python.BaseOptions(
                        model_asset_path=str(FACE_MODEL_PATH)
                    ),
                    running_mode=mp_vision.RunningMode.VIDEO,
                    num_faces=1,
                    min_face_detection_confidence=0.5,
                    min_face_presence_confidence=0.5,
                    min_tracking_confidence=0.5,
                    output_face_blendshapes=False,
                    output_facial_transformation_matrixes=False,
                )
            )
        else:
            print("[HolisticExtractor] face_landmarker.task not found — face features zeroed.")

        if POSE_MODEL_PATH.exists():
            self._pose = mp_vision.PoseLandmarker.create_from_options(
                mp_vision.PoseLandmarkerOptions(
                    base_options=mp_python.BaseOptions(
                        model_asset_path=str(POSE_MODEL_PATH)
                    ),
                    running_mode=mp_vision.RunningMode.VIDEO,
                    num_poses=1,
                    min_pose_detection_confidence=0.5,
                    min_pose_presence_confidence=0.5,
                    min_tracking_confidence=0.5,
                )
            )
        else:
            print("[HolisticExtractor] pose_landmarker_lite.task not found — pose features zeroed.")

        self._t0 = time.perf_counter()

    def process(self, frame_bgr: np.ndarray) -> tuple:
        """
        Run hand + face + pose detection on one BGR webcam frame.

        Returns
        -------
        features     : np.ndarray (150,) — concatenated holistic features, or None
        is_open_palm : bool
        raw_hand_lms : raw hand landmarks for skeleton overlay (or None)
        """
        timestamp_ms = int((time.perf_counter() - self._t0) * 1000)

        small    = cv2.resize(frame_bgr, (MP_W, MP_H))
        rgb      = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        # ── Hand ──────────────────────────────────────────────────────────
        hand_result = self._hand.detect_for_video(mp_image, timestamp_ms)
        if not hand_result.hand_landmarks:
            return None, False, None

        hand_lms     = hand_result.hand_landmarks[0]
        hand_features = self._normalise_hand(hand_lms)
        open_palm     = self._is_open_palm(hand_lms)

        # ── Face ──────────────────────────────────────────────────────────
        face_features = np.zeros(NUM_FACE_FEATURES, dtype=np.float32)
        if self._face is not None:
            face_result = self._face.detect_for_video(mp_image, timestamp_ms)
            if face_result.face_landmarks:
                lms   = face_result.face_landmarks[0]
                coords = np.array(
                    [[lms[i].x, lms[i].y, lms[i].z] for i in FACE_KEY_LMS],
                    dtype=np.float32,
                )
                # Centre on nose tip (index 4 in FACE_KEY_LMS → local index 18)
                nose_local = FACE_KEY_LMS.index(4)
                coords -= coords[nose_local]
                face_features = coords.flatten()

        # ── Pose ──────────────────────────────────────────────────────────
        pose_features = np.zeros(NUM_POSE_FEATURES, dtype=np.float32)
        if self._pose is not None:
            pose_result = self._pose.detect_for_video(mp_image, timestamp_ms)
            if pose_result.pose_landmarks:
                lms   = pose_result.pose_landmarks[0]
                coords = np.array(
                    [[lms[i].x, lms[i].y, lms[i].z] for i in POSE_KEY_LMS],
                    dtype=np.float32,
                )
                # Centre on shoulder midpoint (POSE_KEY_LMS indices 1,2 = shoulders)
                shoulder_mid = (coords[1] + coords[2]) / 2.0
                coords -= shoulder_mid
                pose_features = coords.flatten()

        features = np.concatenate([hand_features, face_features, pose_features])
        return features, open_palm, hand_lms

    def _normalise_hand(self, landmarks) -> np.ndarray:
        """Same normalisation as LandmarkExtractor — must stay in sync."""
        coords = np.array([[lm.x, lm.y, lm.z] for lm in landmarks])
        coords -= coords[0]
        scale   = np.linalg.norm(coords[9])
        if scale > 0:
            coords /= scale
        return coords.flatten().astype(np.float32)

    def _is_open_palm(self, landmarks) -> bool:
        fingers_open = all(
            landmarks[tip].y < landmarks[pip].y
            for tip, pip in zip(FINGERTIP_IDS, PIP_IDS)
        )
        thumb_open = landmarks[THUMB_TIP_ID].y < landmarks[THUMB_IP_ID].y
        return fingers_open and thumb_open

    def close(self) -> None:
        self._hand.close()
        if self._face: self._face.close()
        if self._pose: self._pose.close()

    def __enter__(self):  return self
    def __exit__(self, *_): self.close()
