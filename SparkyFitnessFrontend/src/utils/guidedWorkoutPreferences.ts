import { useSyncExternalStore } from 'react';
import {
  DEFAULT_GUIDED_COUNTDOWN_SEC,
  DEFAULT_GUIDED_SPEECH_RATE,
  clampGuidedCountdownSec,
  clampGuidedSpeechRate,
} from '@workspace/shared';

/**
 * Guided workout settings (#1507). Browser-local on purpose: installed voices
 * differ per browser and device, so none of this syncs to the server.
 */
export interface GuidedWorkoutPreferences {
  enabled: boolean;
  /** SpeechSynthesisVoice.voiceURI; null uses the browser default for the app language. */
  voiceURI: string | null;
  rate: number;
  countdownSec: number;
}

const STORAGE_KEY = 'sparky.guidedWorkoutPreferences.v1';

export const DEFAULT_GUIDED_WORKOUT_PREFERENCES: GuidedWorkoutPreferences = {
  enabled: false,
  voiceURI: null,
  rate: DEFAULT_GUIDED_SPEECH_RATE,
  countdownSec: DEFAULT_GUIDED_COUNTDOWN_SEC,
};

const listeners = new Set<() => void>();
let cached: GuidedWorkoutPreferences | null = null;

function parse(raw: string | null): GuidedWorkoutPreferences {
  if (!raw) return DEFAULT_GUIDED_WORKOUT_PREFERENCES;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') {
      return DEFAULT_GUIDED_WORKOUT_PREFERENCES;
    }
    const v = value as Partial<Record<keyof GuidedWorkoutPreferences, unknown>>;
    return {
      enabled: v.enabled === true,
      voiceURI: typeof v.voiceURI === 'string' ? v.voiceURI : null,
      rate:
        typeof v.rate === 'number'
          ? clampGuidedSpeechRate(v.rate)
          : DEFAULT_GUIDED_SPEECH_RATE,
      countdownSec:
        typeof v.countdownSec === 'number'
          ? clampGuidedCountdownSec(v.countdownSec)
          : DEFAULT_GUIDED_COUNTDOWN_SEC,
    };
  } catch {
    return DEFAULT_GUIDED_WORKOUT_PREFERENCES;
  }
}

export function getGuidedWorkoutPreferences(): GuidedWorkoutPreferences {
  if (cached) return cached;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private mode): fall back to defaults.
  }
  cached = parse(raw);
  return cached;
}

export function setGuidedWorkoutPreferences(
  patch: Partial<GuidedWorkoutPreferences>
): void {
  const next = parse(
    JSON.stringify({ ...getGuidedWorkoutPreferences(), ...patch })
  );
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Keep the in-memory value for this tab.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changed it.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    cached = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useGuidedWorkoutPreferences(): GuidedWorkoutPreferences {
  return useSyncExternalStore(
    subscribe,
    getGuidedWorkoutPreferences,
    () => DEFAULT_GUIDED_WORKOUT_PREFERENCES
  );
}

/** Test-only helper — drops the in-memory copy. */
export function __resetGuidedWorkoutPreferencesForTests(): void {
  cached = null;
}
