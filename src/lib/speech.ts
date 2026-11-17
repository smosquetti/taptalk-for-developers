export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (!ttsSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  const local = voices.find(
    (v) => v.lang?.toLowerCase().startsWith("de") && v.localService,
  );
  const any = voices.find((v) => v.lang?.toLowerCase().startsWith("de"));
  return local ?? any ?? null;
}

/**
 * Speaks German `text` out loud, replacing any in-progress utterance.
 * No-op on browsers without the Web Speech API.
 */
export function speak(text: string, opts: { rate?: number } = {}): void {
  if (!ttsSupported()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "de-DE";
  utterance.rate = opts.rate ?? 0.95;
  utterance.pitch = 1.05;
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  synth.speak(utterance);
}

export function stopSpeaking(): void {
  if (!ttsSupported()) return;
  window.speechSynthesis.cancel();
}
