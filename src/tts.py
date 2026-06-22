"""
tts.py — Text-to-speech via Windows System.Speech (PowerShell).

pyttsx3 / SAPI5 has a known bug on Windows where the engine silently
stops responding after the first runAndWait() call, and it defaults to
the first installed voice (French on this machine).

This module instead spawns a hidden PowerShell process that uses the
built-in System.Speech.Synthesis.SpeechSynthesizer.  It is always
available on Windows, automatically selects an English voice, and each
call is completely independent — no engine state to corrupt.
"""

import subprocess
import threading

SPEECH_RATE   = 1      # System.Speech rate: -10 (slowest) to 10 (fastest). 0 = normal
SPEECH_VOLUME = 90     # 0 – 100


class TTS:
    """Non-blocking TTS using Windows System.Speech via a hidden PowerShell process."""

    def __init__(self, rate: int = SPEECH_RATE, volume: int = SPEECH_VOLUME):
        self._rate   = rate
        self._volume = volume
        self._proc: subprocess.Popen | None = None
        self._lock   = threading.Lock()

    def speak(self, text: str) -> None:
        """Speak text asynchronously. Stops any ongoing speech first."""
        text = text.strip()
        if not text:
            return
        self.stop()
        threading.Thread(target=self._run, args=(text,), daemon=True).start()

    def stop(self) -> None:
        """Kill any in-progress speech process."""
        with self._lock:
            if self._proc and self._proc.poll() is None:
                try:
                    self._proc.terminate()
                except Exception:
                    pass
            self._proc = None

    def _run(self, text: str) -> None:
        # Escape single quotes for PowerShell string literals
        safe_text = text.replace("'", "''")

        script = (
            "Add-Type -AssemblyName System.Speech; "
            "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            # Pick first installed English voice; fall back to default if none found
            "$eng = $synth.GetInstalledVoices() | "
            "  Where-Object { $_.VoiceInfo.Culture.Name -like 'en*' } | "
            "  Select-Object -First 1; "
            "if ($eng) { $synth.SelectVoice($eng.VoiceInfo.Name) }; "
            f"$synth.Rate = {self._rate}; "
            f"$synth.Volume = {self._volume}; "
            f"$synth.Speak('{safe_text}')"
        )

        proc = subprocess.Popen(
            ["powershell", "-WindowStyle", "Hidden", "-NonInteractive", "-Command", script],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        with self._lock:
            self._proc = proc
        proc.wait()

    def set_rate(self, rate: int) -> None:
        self._rate = rate

    def set_volume(self, volume: int) -> None:
        self._volume = volume
