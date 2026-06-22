"""
speech_to_sign.py — Microphone speech-to-text, feeding into text_to_sign.

Listens for one utterance, transcribes it with Google's free speech API
(via SpeechRecognition), and returns the recognised text + image paths.

Runs in a background thread so the GUI stays responsive during recording.
"""

import threading
from pathlib import Path

import speech_recognition as sr

from text_to_sign import text_to_image_paths

# ---------------------------------------------------------------------------
# Tunable constants
# ---------------------------------------------------------------------------
ENERGY_THRESHOLD   = 300    # mic sensitivity; increase in noisy environments
PAUSE_THRESHOLD    = 0.8    # seconds of silence that ends an utterance
PHRASE_TIME_LIMIT  = 10     # max seconds to record a single phrase


class SpeechToSign:
    """
    Records one spoken phrase from the microphone, transcribes it, and
    converts the text to a list of sign image paths.

    Usage
    -----
    listener = SpeechToSign(on_result=my_callback)
    listener.listen()           # non-blocking
    # my_callback(text, image_paths) is called when transcription is ready
    """

    def __init__(self, on_result=None, on_error=None):
        """
        Parameters
        ----------
        on_result : callable(text: str, image_paths: list[Path]) or None
            Called on the main thread when transcription succeeds.
        on_error : callable(message: str) or None
            Called when recognition fails (no speech, network error, etc.).
        """
        self._recognizer = sr.Recognizer()
        self._recognizer.energy_threshold  = ENERGY_THRESHOLD
        self._recognizer.pause_threshold   = PAUSE_THRESHOLD
        self._on_result  = on_result
        self._on_error   = on_error
        self._thread: threading.Thread | None = None
        self.is_listening = False

    def listen(self) -> None:
        """Start a background recording+transcription cycle (non-blocking)."""
        if self.is_listening:
            return
        self.is_listening = True
        self._thread = threading.Thread(target=self._record_and_transcribe, daemon=True)
        self._thread.start()

    def _record_and_transcribe(self) -> None:
        try:
            with sr.Microphone() as source:
                # Brief ambient-noise calibration for cleaner recording
                self._recognizer.adjust_for_ambient_noise(source, duration=0.5)
                audio = self._recognizer.listen(
                    source, phrase_time_limit=PHRASE_TIME_LIMIT
                )

            text = self._recognizer.recognize_google(audio)
            paths = text_to_image_paths(text)

            if self._on_result:
                self._on_result(text, paths)

        except sr.UnknownValueError:
            if self._on_error:
                self._on_error("Could not understand audio — please try again.")
        except sr.RequestError as exc:
            if self._on_error:
                self._on_error(f"Speech service error: {exc}")
        except Exception as exc:
            if self._on_error:
                self._on_error(f"Microphone error: {exc}")
        finally:
            self.is_listening = False
