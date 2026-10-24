/**
 * Browser speech synthesis, shared by the exercise playback modal and the
 * guided workout player (#1507). Every call is guarded: browsers without
 * `speechSynthesis` (and jsdom) turn these into no-ops.
 */

function getSynth(): SpeechSynthesis | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return null;
  }
  return window.speechSynthesis;
}

export function isSpeechSynthesisSupported(): boolean {
  return getSynth() != null;
}

/** Stops the current utterance and drops everything queued behind it. */
export function cancelSpeech(): void {
  const synth = getSynth();
  if (synth && typeof synth.cancel === 'function') synth.cancel();
}

export function pauseSpeech(): void {
  const synth = getSynth();
  if (synth && typeof synth.pause === 'function') synth.pause();
}

/** Resumes paused speech. Returns false when nothing was paused. */
export function resumeSpeech(): boolean {
  const synth = getSynth();
  if (synth && synth.paused && typeof synth.resume === 'function') {
    synth.resume();
    return true;
  }
  return false;
}

export interface SpeakTextOptions {
  voice?: SpeechSynthesisVoice | null;
  /** Used when no voice is given; a voice carries its own language. */
  lang?: string;
  rate?: number;
  /** Cancel whatever is being read first (default true). */
  cancelPrevious?: boolean;
  /** Build the utterance but do not play it (the modal's mute). */
  muted?: boolean;
  onEnd?: () => void;
  onStart?: () => void;
}

/**
 * Speaks one utterance. Returns it (for callers that track the current one),
 * or null when speech is unsupported.
 */
export function speakText(
  text: string,
  options: SpeakTextOptions = {}
): SpeechSynthesisUtterance | null {
  const synth = getSynth();
  if (!synth) return null;
  if (options.cancelPrevious ?? true) cancelSpeech();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = options.lang ?? 'en-US';
  utterance.rate = options.rate ?? 1;
  utterance.pitch = 1;
  if (options.voice) {
    utterance.voice = options.voice;
    utterance.lang = options.voice.lang;
  }
  if (options.onEnd) utterance.onend = options.onEnd;
  if (options.onStart) utterance.onstart = options.onStart;

  if (!options.muted && typeof synth.speak === 'function') {
    synth.speak(utterance);
  }
  return utterance;
}

/**
 * Calls `onVoices` with the installed voices now and whenever the browser
 * finishes loading them (Chrome loads them asynchronously). Returns the
 * unsubscribe.
 */
export function subscribeToSpeechVoices(
  onVoices: (voices: SpeechSynthesisVoice[]) => void
): () => void {
  const synth = getSynth();
  if (!synth) return () => {};
  const load = () => onVoices(synth.getVoices());
  if (typeof synth.addEventListener === 'function') {
    synth.addEventListener('voiceschanged', load);
  } else {
    synth.onvoiceschanged = load;
  }
  load();
  return () => {
    if (typeof synth.removeEventListener === 'function') {
      synth.removeEventListener('voiceschanged', load);
    } else if (synth.onvoiceschanged === load) {
      synth.onvoiceschanged = null;
    }
  };
}

/** The modal's historical default: a female en-US voice, else any en-US one. */
export function pickDefaultSpeechVoice(
  voices: readonly SpeechSynthesisVoice[]
): SpeechSynthesisVoice | undefined {
  return (
    voices.find((v) => v.lang === 'en-US' && v.name.includes('Female')) ||
    voices.find((v) => v.lang === 'en-US') ||
    voices[0]
  );
}
