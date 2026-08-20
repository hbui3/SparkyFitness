import { describe, expect, it } from 'vitest';
import {
  recordTrainingFeedbackRequestSchema,
  setTrainingPreferenceRequestSchema,
} from '@workspace/shared';

describe('training feedback schemas', () => {
  it('accepts structured workout feedback and supplies safe defaults', () => {
    const parsed = recordTrainingFeedbackRequestSchema.parse({
      workoutDate: '2026-08-20',
      workoutName: 'Sparky Full Body A',
      overallRating: 4,
      difficulty: 'just_right',
    });

    expect(parsed).toMatchObject({
      provider: 'speediance',
      exerciseFeedback: [],
      preferenceUpdates: [],
    });
  });

  it('rejects an empty feedback event and out-of-range discomfort', () => {
    expect(
      recordTrainingFeedbackRequestSchema.safeParse({
        workoutName: 'Sparky Full Body A',
      }).success
    ).toBe(false);
    expect(
      recordTrainingFeedbackRequestSchema.safeParse({
        workoutName: 'Sparky Full Body A',
        exerciseFeedback: [
          { exerciseName: 'Barbell Squat', discomfortLevel: 11 },
        ],
      }).success
    ).toBe(false);
  });

  it('stores only explicit structured preference fields', () => {
    const result = setTrainingPreferenceRequestSchema.safeParse({
      kind: 'exercise',
      subject: 'Seated Barbell Row',
      sentiment: 'prefer',
      source: 'coach',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        kind: 'exercise',
        subject: 'Seated Barbell Row',
        sentiment: 'prefer',
      });
    }
  });
});
