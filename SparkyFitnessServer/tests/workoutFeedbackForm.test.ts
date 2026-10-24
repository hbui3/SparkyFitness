import { describe, expect, it } from 'vitest';
import {
  EMPTY_WORKOUT_FEEDBACK_DRAFT,
  hasWorkoutFeedback,
  workoutFeedbackDraftFromResponse,
  workoutFeedbackRequestFromDraft,
  type WorkoutFeedbackDraft,
} from '@workspace/shared';

describe('workoutFeedbackForm', () => {
  it('round-trips a saved response', () => {
    const draft = workoutFeedbackDraftFromResponse({
      exercise_preset_entry_id: 's',
      session: {
        difficulty: 'too_hard',
        pain: true,
        pain_note: 'left shoulder',
        updated_at: 'x',
      },
      exercises: [
        {
          exercise_entry_id: 'e1',
          difficulty: 'too_easy',
          pain: false,
          pain_note: null,
          updated_at: 'x',
        },
        {
          exercise_entry_id: 'e2',
          difficulty: null,
          pain: true,
          pain_note: null,
          updated_at: 'x',
        },
      ],
    });
    expect(draft).toEqual({
      difficulty: 'too_hard',
      pain: true,
      painNote: 'left shoulder',
      painExerciseEntryIds: ['e2'],
      exerciseDifficulty: { e1: 'too_easy' },
    });
    expect(workoutFeedbackRequestFromDraft(draft)).toEqual({
      session: {
        difficulty: 'too_hard',
        pain: true,
        pain_note: 'left shoulder',
      },
      exercises: [
        {
          exercise_entry_id: 'e1',
          difficulty: 'too_easy',
          pain: false,
          pain_note: null,
        },
        {
          exercise_entry_id: 'e2',
          difficulty: null,
          pain: true,
          pain_note: null,
        },
      ],
    });
  });

  it('sends nothing for an empty form', () => {
    expect(
      workoutFeedbackRequestFromDraft(EMPTY_WORKOUT_FEEDBACK_DRAFT)
    ).toEqual({ session: null, exercises: [] });
    expect(hasWorkoutFeedback(EMPTY_WORKOUT_FEEDBACK_DRAFT)).toBe(false);
  });

  it('drops pain details once pain is switched off', () => {
    const draft: WorkoutFeedbackDraft = {
      difficulty: 'just_right',
      pain: false,
      painNote: 'was sore',
      painExerciseEntryIds: ['e1'],
      exerciseDifficulty: { e2: null },
    };
    expect(workoutFeedbackRequestFromDraft(draft)).toEqual({
      session: { difficulty: 'just_right', pain: false, pain_note: null },
      exercises: [],
    });
  });

  it('records pain without a difficulty, trimming the note', () => {
    const draft: WorkoutFeedbackDraft = {
      ...EMPTY_WORKOUT_FEEDBACK_DRAFT,
      pain: true,
      painNote: '  ',
    };
    expect(workoutFeedbackRequestFromDraft(draft).session).toEqual({
      difficulty: null,
      pain: true,
      pain_note: null,
    });
    expect(hasWorkoutFeedback(draft)).toBe(true);
  });

  it('starts empty without a response', () => {
    expect(workoutFeedbackDraftFromResponse(null)).toBe(
      EMPTY_WORKOUT_FEEDBACK_DRAFT
    );
  });
});
