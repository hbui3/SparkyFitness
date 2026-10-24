import { useSyncExternalStore } from 'react';
import type { TFunction } from 'i18next';
import type { GuidedCue } from '@workspace/shared';
import { getGuidedWorkoutPreferences } from '@/utils/guidedWorkoutPreferences';
import { cancelSpeech, speakText } from '@/utils/speechNarrator';

/**
 * Renders a shared guided-workout cue as the sentence to speak, in the app
 * language. Instruction lines are library content and are spoken verbatim.
 */
export function renderGuidedCue(cue: GuidedCue, t: TFunction): string {
  switch (cue.type) {
    case 'getReady':
      return t('guidedWorkout.cue.getReady', {
        defaultValue: 'Get ready. Starting {{name}}.',
        name: cue.exerciseName,
      });
    case 'setStart':
      if (cue.target.kind === 'reps') {
        return t('guidedWorkout.cue.setStartReps', {
          defaultValue: '{{name}}. {{count}} rep.',
          defaultValue_other: '{{name}}. {{count}} reps.',
          name: cue.exerciseName,
          count: cue.target.reps,
        });
      }
      if (cue.target.kind === 'time') {
        return t('guidedWorkout.cue.setStartSeconds', {
          defaultValue: '{{name}}. {{count}} second.',
          defaultValue_other: '{{name}}. {{count}} seconds.',
          name: cue.exerciseName,
          count: cue.target.seconds,
        });
      }
      return t('guidedWorkout.cue.setStartOpen', {
        defaultValue: '{{name}}.',
        name: cue.exerciseName,
      });
    case 'instruction':
      return cue.text;
    case 'halfway':
      return t('guidedWorkout.cue.halfway', 'Halfway.');
    case 'rest':
      return t('guidedWorkout.cue.rest', {
        defaultValue: 'Rest. {{count}} second.',
        defaultValue_other: 'Rest. {{count}} seconds.',
        count: cue.seconds,
      });
    case 'intervalRest':
      return t('guidedWorkout.cue.intervalRest', 'Rest.');
    case 'nextUp':
      return t('guidedWorkout.cue.nextUp', {
        defaultValue: 'Next: {{name}}.',
        name: cue.exerciseName,
      });
    case 'workoutComplete':
      return t('guidedWorkout.cue.workoutComplete', 'Workout complete.');
  }
}

export function renderGuidedCues(
  cues: readonly GuidedCue[],
  t: TFunction
): string[] {
  return cues.map((cue) => renderGuidedCue(cue, t));
}

/** A queue deeper than this is dropped rather than read late. */
const MAX_QUEUED_UTTERANCES = 20;
let pending = 0;

// Per-workout session state shared by the guided card and the interval HUD:
// the voice mute (not a saved setting) and the caption of the line being
// spoken. Captions keep working while muted, as a silent alternative.
let muted = false;
let caption: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setCaption(text: string | null): void {
  if (caption === text) return;
  caption = text;
  emit();
}

export function setGuidedSpeechMuted(value: boolean): void {
  muted = value;
  if (value) stopGuidedSpeech();
  emit();
}

export function useGuidedSpeechMuted(): boolean {
  return useSyncExternalStore(subscribe, () => muted);
}

/** The line being spoken now (or that would be, while muted). */
export function useGuidedCaption(): string | null {
  return useSyncExternalStore(subscribe, () => caption);
}

/** Clears mute and caption when a guided view goes away. */
export function resetGuidedSpeechSession(): void {
  muted = false;
  caption = null;
  emit();
}

function findVoice(voiceURI: string | null): SpeechSynthesisVoice | null {
  if (!voiceURI || typeof window === 'undefined') return null;
  if (!('speechSynthesis' in window)) return null;
  return (
    window.speechSynthesis.getVoices().find((v) => v.voiceURI === voiceURI) ??
    null
  );
}

/**
 * Speaks `lines` in order with the guided voice and rate. `interrupt` cancels
 * whatever is still being read first. Skipped while guided mode is off or the
 * tab is hidden (a hidden tab's timers are throttled, so speech would land
 * late).
 */
export function speakGuided(
  lines: readonly string[],
  options: { interrupt?: boolean; lang?: string } = {}
): void {
  const prefs = getGuidedWorkoutPreferences();
  if (!prefs.enabled || lines.length === 0) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden')
    return;
  // A new batch replaces the caption; a queued one (e.g. "Halfway") takes
  // over as it starts speaking.
  if (options.interrupt || pending === 0 || muted) setCaption(lines[0] ?? null);
  if (muted) return;
  if (options.interrupt) stopGuidedSpeech();
  const voice = findVoice(prefs.voiceURI);
  for (const text of lines) {
    if (pending >= MAX_QUEUED_UTTERANCES) return;
    pending += 1;
    speakText(text, {
      voice,
      lang: options.lang,
      rate: prefs.rate,
      cancelPrevious: false,
      onStart: () => setCaption(text),
      onEnd: () => {
        pending = Math.max(0, pending - 1);
      },
    });
  }
}

export function stopGuidedSpeech(): void {
  pending = 0;
  cancelSpeech();
}
