/** tts.ts — Web Speech API TTS, replacing pyttsx3. */

export function speak(text: string, rate = 1.0, pitch = 1.0): void {
  if (!text.trim() || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text.trim());
  utt.rate = rate;
  utt.pitch = pitch;
  window.speechSynthesis.speak(utt);
}

export function stopSpeech(): void {
  window.speechSynthesis?.cancel();
}

export function isTTSSupported(): boolean {
  return "speechSynthesis" in window;
}
