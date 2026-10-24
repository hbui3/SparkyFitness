import type { TFunction } from 'i18next';
import { translateForTest } from '@/tests/mocks/reactI18next';
import { act, renderHook } from '@testing-library/react';
import {
  renderGuidedCue,
  resetGuidedSpeechSession,
  setGuidedSpeechMuted,
  speakGuided,
  stopGuidedSpeech,
  useGuidedCaption,
} from '@/utils/guidedWorkoutSpeech';
import {
  __resetGuidedWorkoutPreferencesForTests,
  setGuidedWorkoutPreferences,
} from '@/utils/guidedWorkoutPreferences';
import {
  installSpeechSynthesisMock,
  removeSpeechSynthesisMock,
  type SpeechSynthesisMock,
} from '@/tests/mocks/speechSynthesisMock';

const t = translateForTest as unknown as TFunction;

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

describe('renderGuidedCue', () => {
  it('renders set targets with plurals', () => {
    expect(
      renderGuidedCue(
        {
          type: 'setStart',
          exerciseName: 'Push-up',
          target: { kind: 'reps', reps: 12 },
          setNumber: 1,
          totalSets: 3,
        },
        t
      )
    ).toBe('Push-up. 12 reps.');
    expect(
      renderGuidedCue(
        {
          type: 'setStart',
          exerciseName: 'Push-up',
          target: { kind: 'reps', reps: 1 },
          setNumber: 1,
          totalSets: 3,
        },
        t
      )
    ).toBe('Push-up. 1 rep.');
    expect(
      renderGuidedCue(
        {
          type: 'setStart',
          exerciseName: 'Plank',
          target: { kind: 'time', seconds: 45 },
          setNumber: 1,
          totalSets: 1,
        },
        t
      )
    ).toBe('Plank. 45 seconds.');
  });

  it('renders the remaining cues', () => {
    expect(
      renderGuidedCue({ type: 'getReady', exerciseName: 'Squat' }, t)
    ).toBe('Get ready. Starting Squat.');
    expect(renderGuidedCue({ type: 'rest', seconds: 60 }, t)).toBe(
      'Rest. 60 seconds.'
    );
    expect(renderGuidedCue({ type: 'nextUp', exerciseName: 'Row' }, t)).toBe(
      'Next: Row.'
    );
    expect(renderGuidedCue({ type: 'instruction', text: 'Brace.' }, t)).toBe(
      'Brace.'
    );
    expect(renderGuidedCue({ type: 'workoutComplete' }, t)).toBe(
      'Workout complete.'
    );
  });
});

describe('speakGuided', () => {
  let synth: SpeechSynthesisMock;

  beforeEach(() => {
    window.localStorage.clear();
    __resetGuidedWorkoutPreferencesForTests();
    synth = installSpeechSynthesisMock([
      { voiceURI: 'v1', name: 'Voice', lang: 'en-GB' },
    ]);
    setVisibility('visible');
    resetGuidedSpeechSession();
    stopGuidedSpeech();
    synth.cancel.mockClear();
  });

  afterEach(() => removeSpeechSynthesisMock());

  it('is silent while guided mode is off (the default)', () => {
    speakGuided(['Halfway.']);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('queues lines with the chosen voice and rate', () => {
    setGuidedWorkoutPreferences({ enabled: true, voiceURI: 'v1', rate: 1.5 });
    speakGuided(['Push-up. 12 reps.', 'Brace.'], { lang: 'en' });
    expect(synth.spoken.map((u) => u.text)).toEqual([
      'Push-up. 12 reps.',
      'Brace.',
    ]);
    expect(synth.spoken[0]).toMatchObject({ rate: 1.5, lang: 'en-GB' });
    // Queued, not cancelling each other.
    expect(synth.cancel).not.toHaveBeenCalled();
  });

  it('cancels stale speech when interrupting', () => {
    setGuidedWorkoutPreferences({ enabled: true });
    speakGuided(['Rest. 60 seconds.'], { interrupt: true });
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it('stays silent in a hidden tab', () => {
    setGuidedWorkoutPreferences({ enabled: true });
    setVisibility('hidden');
    speakGuided(['Halfway.']);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('never queues deeply', () => {
    setGuidedWorkoutPreferences({ enabled: true });
    speakGuided(Array.from({ length: 30 }, (_, i) => `line ${i}`));
    expect(synth.speak).toHaveBeenCalledTimes(20);
  });

  it('captions the first line, then each line as it starts', () => {
    setGuidedWorkoutPreferences({ enabled: true });
    const { result } = renderHook(() => useGuidedCaption());
    act(() =>
      speakGuided(['Push-up. 12 reps.', 'Brace.'], { interrupt: true })
    );
    expect(result.current).toBe('Push-up. 12 reps.');
    act(() => {
      synth.spoken[1]?.onstart?.(new Event('start') as SpeechSynthesisEvent);
    });
    expect(result.current).toBe('Brace.');
  });

  it('stays silent while muted but keeps captioning', () => {
    setGuidedWorkoutPreferences({ enabled: true });
    const { result } = renderHook(() => useGuidedCaption());
    act(() => setGuidedSpeechMuted(true));
    act(() => speakGuided(['Rest. 30 seconds.'], { interrupt: true }));
    expect(synth.speak).not.toHaveBeenCalled();
    expect(result.current).toBe('Rest. 30 seconds.');
  });
});
