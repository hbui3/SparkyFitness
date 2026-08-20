import { describe, expect, it } from 'vitest';
import {
  speedianceCreateAndScheduleWorkoutRequestSchema,
  speedianceExerciseSearchRequestSchema,
} from '@workspace/shared';

describe('Speediance workout schemas', () => {
  it('applies safe hypertrophy defaults to every set', () => {
    const parsed = speedianceCreateAndScheduleWorkoutRequestSchema.parse({
      name: 'Sparky Full Body A',
      scheduleDate: '2026-08-20',
      exercises: [
        {
          groupId: '116',
          variantId: '2927',
          expectedTitle: 'Barbell Bench Press',
          sets: [{ repetitions: 10 }],
        },
      ],
    });

    expect(parsed.exercises[0].sets[0]).toEqual({
      repetitions: 10,
      targetRm: 12,
      mode: 'standard',
      restSeconds: 90,
    });
    expect(parsed.acknowledgedPreferenceIds).toEqual([]);
  });

  it('requires numeric group and variant IDs plus the exact exercise title', () => {
    const base = {
      name: 'Sparky Full Body A',
      scheduleDate: '2026-08-20',
      exercises: [
        {
          groupId: 'not-an-id',
          variantId: '2927',
          sets: [{ repetitions: 10 }],
        },
      ],
    };

    expect(
      speedianceCreateAndScheduleWorkoutRequestSchema.safeParse(base).success
    ).toBe(false);
    expect(
      speedianceCreateAndScheduleWorkoutRequestSchema.safeParse({
        ...base,
        exercises: [
          {
            groupId: '116',
            variantId: '2927',
            sets: [{ repetitions: 10 }],
          },
        ],
      }).success
    ).toBe(false);
  });

  it('bounds library search output and supplies defaults', () => {
    expect(speedianceExerciseSearchRequestSchema.parse({})).toEqual({
      query: '',
      limit: 50,
    });
    expect(
      speedianceExerciseSearchRequestSchema.safeParse({ limit: 101 }).success
    ).toBe(false);
  });
});
