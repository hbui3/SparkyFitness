import { describe, it, expect } from 'vitest';
import {
  buildGuidedIntervalPhaseCues,
  buildGuidedReplayCues,
  buildGuidedRestCues,
  buildGuidedSessionStartCues,
  buildGuidedSetStartCues,
  buildGuidedWorkoutCompleteCues,
  buildIntervalPhases,
  clampGuidedCountdownSec,
  clampGuidedSpeechRate,
  normalizeGuidedInstructions,
  resolveGuidedSetTarget,
  shouldSpeakGuidedHalfway,
  DEFAULT_GUIDED_COUNTDOWN_SEC,
  DEFAULT_GUIDED_SPEECH_RATE,
  type GuidedSetTarget,
} from '@workspace/shared';

describe('guidedWorkoutCues', () => {
  describe('clamping', () => {
    it('clamps the countdown to 3–15 whole seconds', () => {
      expect(clampGuidedCountdownSec(1)).toBe(3);
      expect(clampGuidedCountdownSec(7.4)).toBe(7);
      expect(clampGuidedCountdownSec(40)).toBe(15);
      expect(clampGuidedCountdownSec(Number.NaN)).toBe(
        DEFAULT_GUIDED_COUNTDOWN_SEC
      );
    });

    it('clamps the speech rate to 0.5–2.0 in 0.25 steps', () => {
      expect(clampGuidedSpeechRate(0.1)).toBe(0.5);
      expect(clampGuidedSpeechRate(1.1)).toBe(1);
      expect(clampGuidedSpeechRate(1.2)).toBe(1.25);
      expect(clampGuidedSpeechRate(3)).toBe(2);
      expect(clampGuidedSpeechRate(Number.POSITIVE_INFINITY)).toBe(
        DEFAULT_GUIDED_SPEECH_RATE
      );
    });
  });

  describe('resolveGuidedSetTarget', () => {
    it('treats a duration modality with a duration as timed', () => {
      expect(
        resolveGuidedSetTarget('duration', { duration: 45, reps: 10 })
      ).toEqual({ kind: 'time', seconds: 45 });
    });

    it('prefers reps on strength sets', () => {
      expect(
        resolveGuidedSetTarget('weight_reps', { reps: 8, duration: 30 })
      ).toEqual({ kind: 'reps', reps: 8 });
    });

    it('falls back to a duration on a strength set without reps', () => {
      expect(
        resolveGuidedSetTarget('reps_only', { reps: null, duration: 20 })
      ).toEqual({ kind: 'time', seconds: 20 });
    });

    it('is open when the set has neither', () => {
      expect(
        resolveGuidedSetTarget('weight_reps', { reps: 0, duration: null })
      ).toEqual({ kind: 'open' });
    });
  });

  it('normalizes instruction lines', () => {
    expect(normalizeGuidedInstructions(['  Brace ', '', '  ', 'Push'])).toEqual(
      ['Brace', 'Push']
    );
    expect(normalizeGuidedInstructions(null)).toEqual([]);
  });

  describe('set start', () => {
    const base = {
      exerciseName: 'Push-up',
      target: { kind: 'reps', reps: 12 } as GuidedSetTarget,
      totalSets: 3,
      instructions: ['Keep your core firm.', ' ', 'Lower slowly.'],
    };

    it('reads every instruction on the first set', () => {
      expect(buildGuidedSetStartCues({ ...base, setNumber: 1 })).toEqual([
        {
          type: 'setStart',
          exerciseName: 'Push-up',
          target: { kind: 'reps', reps: 12 },
          setNumber: 1,
          totalSets: 3,
        },
        { type: 'instruction', text: 'Keep your core firm.' },
        { type: 'instruction', text: 'Lower slowly.' },
      ]);
    });

    it('announces only the target on later sets', () => {
      const cues = buildGuidedSetStartCues({ ...base, setNumber: 2 });
      expect(cues).toHaveLength(1);
      expect(cues[0]?.type).toBe('setStart');
    });

    it('opens the session with get ready', () => {
      expect(buildGuidedSessionStartCues({ ...base, setNumber: 1 })).toEqual([
        { type: 'getReady', exerciseName: 'Push-up' },
      ]);
    });
  });

  describe('replay', () => {
    const set = {
      exerciseName: 'Push-up',
      target: { kind: 'reps', reps: 10 } as GuidedSetTarget,
      setNumber: 2,
      totalSets: 3,
      instructions: ['Keep your core firm.', 'Lower slowly.'],
    };

    it('reads every instruction again, even on a later set', () => {
      expect(buildGuidedReplayCues(set, false)).toEqual([
        {
          type: 'setStart',
          exerciseName: 'Push-up',
          target: { kind: 'reps', reps: 10 },
          setNumber: 2,
          totalSets: 3,
        },
        { type: 'instruction', text: 'Keep your core firm.' },
        { type: 'instruction', text: 'Lower slowly.' },
      ]);
    });

    it('previews the next set during a rest', () => {
      const cues = buildGuidedReplayCues(set, true);
      expect(cues[0]).toEqual({ type: 'nextUp', exerciseName: 'Push-up' });
      expect(cues).toHaveLength(4);
    });
  });

  it('announces rest and what comes next', () => {
    expect(buildGuidedRestCues(90, { exerciseName: 'Squat' })).toEqual([
      { type: 'rest', seconds: 90 },
      { type: 'nextUp', exerciseName: 'Squat' },
    ]);
    expect(buildGuidedRestCues(0, null)).toEqual([]);
  });

  it('ends with workout complete', () => {
    expect(buildGuidedWorkoutCompleteCues()).toEqual([
      { type: 'workoutComplete' },
    ]);
  });

  describe('halfway', () => {
    it('fires once when half the time remains', () => {
      expect(shouldSpeakGuidedHalfway(40, 21, false)).toBe(false);
      expect(shouldSpeakGuidedHalfway(40, 20, false)).toBe(true);
      expect(shouldSpeakGuidedHalfway(40, 19, true)).toBe(false);
    });

    it('stays quiet on short sets so it never meets the beeps', () => {
      expect(shouldSpeakGuidedHalfway(8, 4, false)).toBe(false);
    });
  });

  describe('interval phases', () => {
    const steps = [
      { exerciseName: 'Burpee', target: { kind: 'open' } as GuidedSetTarget },
      {
        exerciseName: 'Squat',
        target: { kind: 'reps', reps: 15 } as GuidedSetTarget,
      },
    ];
    const getStep = (i: number) => steps[i] ?? null;
    const phases = buildIntervalPhases(
      {
        format: 'tabata',
        countdownSeconds: 5,
        steps: [
          { exerciseName: 'Burpee', durationSec: 20, restSec: 10 },
          { exerciseName: 'Squat', durationSec: 20, restSec: 10 },
        ],
        tabataRounds: 1,
      },
      0
    );

    it('says get ready for the first work step during the countdown', () => {
      expect(buildGuidedIntervalPhaseCues(phases[0]!, phases, getStep)).toEqual(
        [{ type: 'getReady', exerciseName: 'Burpee' }]
      );
    });

    it('uses the phase length as a timed target on work phases', () => {
      const work = phases[1]!;
      expect(buildGuidedIntervalPhaseCues(work, phases, getStep)).toEqual([
        {
          type: 'setStart',
          exerciseName: 'Burpee',
          target: { kind: 'time', seconds: 20 },
          setNumber: 1,
          totalSets: 1,
        },
      ]);
    });

    it('keeps a rep target on work phases', () => {
      const squatWork = phases.find(
        (p) => p.kind === 'work' && p.stepIndex === 1
      )!;
      const cues = buildGuidedIntervalPhaseCues(squatWork, phases, getStep);
      expect(cues[0]).toMatchObject({ target: { kind: 'reps', reps: 15 } });
    });

    it('announces the next exercise on rest when it changes', () => {
      const firstRest = phases[2]!;
      expect(buildGuidedIntervalPhaseCues(firstRest, phases, getStep)).toEqual([
        { type: 'intervalRest' },
        { type: 'nextUp', exerciseName: 'Squat' },
      ]);
    });

    it('does not repeat the exercise when the next work is the same step', () => {
      const emom = buildIntervalPhases(
        {
          format: 'emom',
          countdownSeconds: 0,
          emomRounds: 2,
          steps: [{ exerciseName: 'Burpee', durationSec: 40 }],
        },
        0
      );
      const rest = emom.find((p) => p.kind === 'rest')!;
      expect(buildGuidedIntervalPhaseCues(rest, emom, getStep)).toEqual([
        { type: 'intervalRest' },
      ]);
    });

    it('says workout complete when finished', () => {
      expect(
        buildGuidedIntervalPhaseCues(
          {
            kind: 'finished',
            phaseIndex: 99,
            stepIndex: null,
            round: 1,
            totalRounds: 1,
            durationSec: 0,
            startsAt: 0,
            endsAt: 0,
          },
          phases,
          getStep
        )
      ).toEqual([{ type: 'workoutComplete' }]);
    });
  });
});
