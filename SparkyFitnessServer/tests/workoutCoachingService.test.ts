import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getExerciseEntrySessionId,
  getSessionFeedbackRows,
  getSessionOwnership,
  replaceSessionFeedback,
} from '../models/workoutFeedbackRepository.js';
import {
  WorkoutEntryNotInSessionError,
  WorkoutFeedbackValidationError,
  WorkoutSessionNotFoundError,
  getWorkoutSessionFeedback,
  setWorkoutFeedbackForEntry,
  updateWorkoutSessionFeedback,
} from '../services/workoutCoachingService.js';

vi.mock('../models/workoutFeedbackRepository.js', () => ({
  getSessionOwnership: vi.fn(),
  getSessionFeedbackRows: vi.fn(),
  replaceSessionFeedback: vi.fn(),
  getExerciseEntrySessionId: vi.fn(),
  getAdaptiveSuggestionsSetting: vi.fn(),
  setAdaptiveSuggestionsSetting: vi.fn(),
}));

const SESSION = 'session-1';
const updatedAt = new Date('2026-09-26T10:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionOwnership).mockResolvedValue({
    userId: 'owner-1',
    exerciseEntryIds: ['e1', 'e2'],
  });
  vi.mocked(getSessionFeedbackRows).mockResolvedValue([
    {
      exercise_preset_entry_id: SESSION,
      exercise_entry_id: null,
      difficulty: 'too_hard',
      pain: false,
      pain_note: null,
      updated_at: updatedAt,
    },
    {
      exercise_preset_entry_id: null,
      exercise_entry_id: 'e1',
      difficulty: null,
      pain: true,
      pain_note: 'wrist',
      updated_at: updatedAt,
    },
  ]);
});

describe('getWorkoutSessionFeedback', () => {
  it('splits session and exercise rows', async () => {
    const result = await getWorkoutSessionFeedback(
      'owner-1',
      'owner-1',
      SESSION
    );
    expect(result).toEqual({
      exercise_preset_entry_id: SESSION,
      session: {
        difficulty: 'too_hard',
        pain: false,
        pain_note: null,
        updated_at: updatedAt.toISOString(),
      },
      exercises: [
        {
          exercise_entry_id: 'e1',
          difficulty: null,
          pain: true,
          pain_note: 'wrist',
          updated_at: updatedAt.toISOString(),
        },
      ],
    });
  });

  it('throws when the session is not visible', async () => {
    vi.mocked(getSessionOwnership).mockResolvedValue(null);
    await expect(
      getWorkoutSessionFeedback('owner-1', 'owner-1', SESSION)
    ).rejects.toBeInstanceOf(WorkoutSessionNotFoundError);
  });
});

describe('updateWorkoutSessionFeedback', () => {
  it('writes as the session owner, keeping the acting user for audit', async () => {
    await updateWorkoutSessionFeedback('owner-1', 'delegate-1', SESSION, {
      session: { difficulty: 'too_easy', pain: false, pain_note: null },
      exercises: [
        {
          exercise_entry_id: 'e2',
          difficulty: null,
          pain: true,
          pain_note: 'knee',
        },
      ],
    });
    expect(replaceSessionFeedback).toHaveBeenCalledWith(
      'owner-1',
      'delegate-1',
      SESSION,
      { difficulty: 'too_easy', pain: false, painNote: null },
      new Map([['e2', { difficulty: null, pain: true, painNote: 'knee' }]]),
      ['e1', 'e2']
    );
  });

  it('rejects exercise entries from another session', async () => {
    await expect(
      updateWorkoutSessionFeedback('owner-1', 'owner-1', SESSION, {
        session: null,
        exercises: [
          {
            exercise_entry_id: 'elsewhere',
            difficulty: 'too_hard',
            pain: false,
          },
        ],
      })
    ).rejects.toBeInstanceOf(WorkoutFeedbackValidationError);
    expect(replaceSessionFeedback).not.toHaveBeenCalled();
  });

  it('drops a note when pain is off', async () => {
    await updateWorkoutSessionFeedback('owner-1', 'owner-1', SESSION, {
      session: { difficulty: 'just_right', pain: false, pain_note: 'stale' },
      exercises: [],
    });
    expect(vi.mocked(replaceSessionFeedback).mock.calls[0][3]).toEqual({
      difficulty: 'just_right',
      pain: false,
      painNote: null,
    });
  });
});

describe('setWorkoutFeedbackForEntry', () => {
  beforeEach(() => {
    vi.mocked(getExerciseEntrySessionId).mockResolvedValue({
      found: true,
      presetEntryId: SESSION,
    });
  });

  it('rates the session and keeps existing exercise feedback', async () => {
    await setWorkoutFeedbackForEntry('owner-1', 'owner-1', 'e2', 'session', {
      difficulty: 'too_easy',
      pain: false,
      pain_note: null,
    });
    expect(replaceSessionFeedback).toHaveBeenCalledWith(
      'owner-1',
      'owner-1',
      SESSION,
      { difficulty: 'too_easy', pain: false, painNote: null },
      new Map([['e1', { difficulty: null, pain: true, painNote: 'wrist' }]]),
      ['e1', 'e2']
    );
  });

  it('rates one exercise and keeps the session rating', async () => {
    await setWorkoutFeedbackForEntry('owner-1', 'owner-1', 'e1', 'exercise', {
      difficulty: 'too_hard',
      pain: false,
      pain_note: null,
    });
    const call = vi.mocked(replaceSessionFeedback).mock.calls[0];
    expect(call[3]).toEqual({
      difficulty: 'too_hard',
      pain: false,
      painNote: null,
    });
    expect(call[4]).toEqual(
      new Map([['e1', { difficulty: 'too_hard', pain: false, painNote: null }]])
    );
  });

  it('refuses entries that are not in a session, or missing ones', async () => {
    vi.mocked(getExerciseEntrySessionId).mockResolvedValue({
      found: true,
      presetEntryId: null,
    });
    await expect(
      setWorkoutFeedbackForEntry('owner-1', 'owner-1', 'solo', 'session', {
        difficulty: 'too_hard',
        pain: false,
      })
    ).rejects.toBeInstanceOf(WorkoutEntryNotInSessionError);

    vi.mocked(getExerciseEntrySessionId).mockResolvedValue({
      found: false,
      presetEntryId: null,
    });
    await expect(
      setWorkoutFeedbackForEntry('owner-1', 'owner-1', 'nope', 'session', {
        difficulty: 'too_hard',
        pain: false,
      })
    ).rejects.toBeInstanceOf(WorkoutSessionNotFoundError);
  });

  it('keeps recorded pain when only the difficulty changes', async () => {
    vi.mocked(getSessionFeedbackRows).mockResolvedValue([
      {
        exercise_preset_entry_id: SESSION,
        exercise_entry_id: null,
        difficulty: 'just_right',
        pain: true,
        pain_note: 'knee',
        updated_at: updatedAt,
      },
    ]);
    await setWorkoutFeedbackForEntry('owner-1', 'owner-1', 'e1', 'session', {
      difficulty: 'too_hard',
    });
    expect(vi.mocked(replaceSessionFeedback).mock.calls[0][3]).toEqual({
      difficulty: 'too_hard',
      pain: true,
      painNote: 'knee',
    });
  });

  it('clears pain and its note on pain=false, and a lone note implies pain', async () => {
    vi.mocked(getSessionFeedbackRows).mockResolvedValue([
      {
        exercise_preset_entry_id: SESSION,
        exercise_entry_id: null,
        difficulty: 'too_hard',
        pain: true,
        pain_note: 'knee',
        updated_at: updatedAt,
      },
    ]);
    await setWorkoutFeedbackForEntry('owner-1', 'owner-1', 'e1', 'session', {
      pain: false,
    });
    expect(vi.mocked(replaceSessionFeedback).mock.calls[0][3]).toEqual({
      difficulty: 'too_hard',
      pain: false,
      painNote: null,
    });

    vi.mocked(getSessionFeedbackRows).mockResolvedValue([]);
    await setWorkoutFeedbackForEntry('owner-1', 'owner-1', 'e1', 'exercise', {
      pain_note: 'wrist',
    });
    expect(vi.mocked(replaceSessionFeedback).mock.calls[1][4]).toEqual(
      new Map([['e1', { difficulty: null, pain: true, painNote: 'wrist' }]])
    );
  });
});
