import type { PresetSessionResponse } from '@workspace/shared';
import { initializeI18n } from '../../src/localization/i18n';
import type { ActiveWorkoutState } from '../../src/stores/activeWorkoutStore';
import { computeAndroidWorkoutNotification } from '../../src/services/workoutLiveActivity.android';

jest.mock('../../src/services/notifications', () => ({
  scheduleRestNotification: jest.fn(async () => 'rest-notification'),
  cancelScheduledNotification: jest.fn(async () => undefined),
  fireRestCompleteCue: jest.fn(),
}));

jest.mock('../../src/services/haptics', () => ({
  fireSuccessHaptic: jest.fn(),
  fireSelectionHaptic: jest.fn(),
}));

const START = 1_700_000_000_000;

function session(): PresetSessionResponse {
  return {
    type: 'preset',
    id: 'workout-1',
    entry_date: '2026-09-26',
    workout_preset_id: null,
    name: 'Strength',
    description: null,
    notes: null,
    source: 'sparky',
    total_duration_minutes: 60,
    activity_details: [],
    exercises: [
      {
        id: 'exercise-1',
        exercise_snapshot: { name: 'Squat' },
        sets: [
          { id: 101, set_number: 1 },
          { id: 102, set_number: 2 },
        ],
      },
      {
        id: 'exercise-2',
        exercise_snapshot: { name: 'Press' },
        sets: [{ id: 201, set_number: 1 }],
      },
    ],
  } as PresetSessionResponse;
}

function state(): Pick<
  ActiveWorkoutState,
  | 'sessionId'
  | 'session'
  | 'startedAt'
  | 'activeSetId'
  | 'steps'
  | 'completedSetIds'
  | 'rest'
> {
  return {
    sessionId: 'workout-1',
    session: session(),
    startedAt: START,
    activeSetId: '102',
    steps: [
      {
        exerciseId: 'exercise-1',
        setId: '101',
        exerciseName: 'Squat',
        exerciseImage: null,
        restSec: 60,
      },
      {
        exerciseId: 'exercise-1',
        setId: '102',
        exerciseName: 'Squat',
        exerciseImage: null,
        restSec: 60,
      },
      {
        exerciseId: 'exercise-2',
        setId: '201',
        exerciseName: 'Press',
        exerciseImage: null,
        restSec: 60,
      },
    ],
    completedSetIds: { '101': START + 30_000 },
    rest: {
      state: 'resting',
      durationSec: 60,
      endsAt: START + 90_000,
      pausedRemainingMs: null,
      scheduledNotificationId: null,
      instanceToken: 1,
    },
  };
}

describe('Android workout notification projection', () => {
  beforeAll(async () => {
    await initializeI18n('en');
  });

  it('reports the current set and exercise segment sizes', () => {
    const result = computeAndroidWorkoutNotification(state());
    expect(result).toMatchObject({
      name: 'Strength',
      phase: 'resting',
      exerciseLine: 'Squat · Set 2 of 2',
      restEndsAt: START + 90_000,
      progressText: '0 / 2 exercises',
      setPosition: '2/3',
      completedSets: 1,
      setCounts: [2, 1],
    });
  });

  it('freezes the duration after the last set and marks all segments complete', () => {
    const workout = state();
    workout.activeSetId = null;
    workout.completedSetIds = {
      '101': START + 30_000,
      '102': START + 60_000,
      '201': START + 125_000,
    };
    workout.rest = { ...workout.rest, state: 'ready', endsAt: null };
    expect(computeAndroidWorkoutNotification(workout)).toMatchObject({
      phase: 'complete',
      elapsedText: 'Elapsed: 02:05',
      progressText: '2 / 2 exercises',
      setPosition: '3/3',
      completedSets: 3,
      restEndsAt: null,
    });
  });

  it('uses the active set position even when sets are completed out of order', () => {
    const workout = state();
    workout.activeSetId = '201';
    expect(computeAndroidWorkoutNotification(workout)).toMatchObject({
      setPosition: '3/3',
      completedSets: 1,
    });
  });

  it('omits the notification after the workout is cleared', () => {
    expect(
      computeAndroidWorkoutNotification({ ...state(), sessionId: null })
    ).toBeNull();
  });
});
