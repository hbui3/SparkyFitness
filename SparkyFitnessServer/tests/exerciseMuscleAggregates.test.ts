import { describe, expect, it } from 'vitest';
import {
  calculateExerciseVariety,
  calculateMuscleGroupRecovery,
  calculateMuscleGroupSets,
  primaryMusclesOf,
} from '@workspace/shared';

const CHEST_JSON = '["Chest","Triceps"]';

describe('primaryMusclesOf', () => {
  it('reads the flat HealthKit/repo column', () => {
    expect(primaryMusclesOf({ exercise_primary_muscles: CHEST_JSON })).toEqual([
      'Chest',
      'Triceps',
    ]);
  });

  it('reads an already-parsed nested array from getReportsData', () => {
    expect(
      primaryMusclesOf({
        exercises: { primary_muscles: ['Chest', 'Triceps'] },
      })
    ).toEqual(['Chest', 'Triceps']);
  });

  it('still parses a nested JSON string (the old recovery/variety shape)', () => {
    expect(
      primaryMusclesOf({
        exercises: { primary_muscles: CHEST_JSON },
      })
    ).toEqual(['Chest', 'Triceps']);
  });

  it('returns [] when nothing is present', () => {
    expect(primaryMusclesOf({})).toEqual([]);
    expect(primaryMusclesOf({ exercise_primary_muscles: null })).toEqual([]);
    expect(primaryMusclesOf({ exercises: { primary_muscles: '[]' } })).toEqual(
      []
    );
  });
});

describe('muscle-group aggregates from flat exercise entries', () => {
  const entries = [
    {
      entry_date: '2026-09-20',
      exercise_name: 'Bench Press',
      exercise_primary_muscles: CHEST_JSON,
    },
    {
      entry_date: '2026-09-22',
      exercise_name: 'Incline Press',
      exercise_primary_muscles: '["Chest"]',
    },
    {
      entry_date: '2026-09-21',
      exercise_name: 'Row',
      exercise_primary_muscles: '["Back"]',
    },
  ];

  it('tracks the most recent date a muscle was trained', () => {
    expect(calculateMuscleGroupRecovery(entries)).toEqual({
      Chest: '2026-09-22',
      Triceps: '2026-09-20',
      Back: '2026-09-21',
    });
  });

  it('counts unique exercises per muscle', () => {
    expect(calculateExerciseVariety(entries)).toEqual({
      Chest: 2,
      Triceps: 1,
      Back: 1,
    });
  });

  it('merges the same muscle logged under different casings', () => {
    expect(
      calculateMuscleGroupRecovery([
        {
          entry_date: '2026-09-16',
          exercise_primary_muscles: '["biceps"]',
        },
        {
          entry_date: '2026-09-22',
          exercise_primary_muscles: '["Biceps"]',
        },
      ])
    ).toEqual({ Biceps: '2026-09-22' });
    expect(
      primaryMusclesOf({ exercise_primary_muscles: '["biceps","Biceps"]' })
    ).toEqual(['Biceps']);
  });

  it('does not JSON.parse an already-parsed nested array', () => {
    const nested = [
      {
        entry_date: '2026-09-22',
        exercise_name: 'Bench Press',
        exercises: { primary_muscles: ['Chest'] },
      },
    ];
    expect(calculateMuscleGroupRecovery(nested)).toEqual({
      Chest: '2026-09-22',
    });
    expect(calculateExerciseVariety(nested)).toEqual({ Chest: 1 });
  });

  it('counts working sets per primary muscle', () => {
    expect(
      calculateMuscleGroupSets([
        {
          exercise_primary_muscles: '["Chest","Triceps"]',
          sets: [
            { reps: 10, weight: 60 },
            { reps: 8, weight: 60 },
            { reps: 0, weight: 0 },
          ],
        },
        {
          exercise_primary_muscles: '["chest"]',
          sets: [{ reps: 12, weight: 40 }],
        },
      ])
    ).toEqual({ Chest: 3, Triceps: 2 });
  });

  it('leaves warm-up sets out of the count', () => {
    expect(
      calculateMuscleGroupSets([
        {
          exercise_primary_muscles: '["Chest"]',
          sets: [
            { set_type: 'Warm-up', reps: 10, weight: 20 },
            { set_type: 'warmup', reps: 8, weight: 40 },
            { set_type: 'Working Set', reps: 5, weight: 80 },
            { set_type: 'Drop Set', reps: 8, weight: 60 },
          ],
        },
      ])
    ).toEqual({ Chest: 2 });
  });
});
