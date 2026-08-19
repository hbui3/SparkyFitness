import { describe, expect, it } from 'vitest';
import type { ReportExerciseEntryRow } from '../models/reportRepository.js';
import {
  calculateCanonicalWorkoutAggregates,
  calculateExerciseCaloriesByDate,
  deduplicateWorkoutRows,
} from '../services/workoutDeduplicationService.js';

function workoutRow(
  overrides: Partial<ReportExerciseEntryRow> &
    Pick<ReportExerciseEntryRow, 'id' | 'exercise_source'>
): ReportExerciseEntryRow {
  return {
    entry_date: '2026-08-19',
    entry_time: null,
    duration_minutes: 13.35,
    calories_burned: 118,
    notes: null,
    exercise_id: `exercise-${overrides.id}`,
    exercise_name: 'Cycling',
    exercise_category: 'Cardio',
    exercise_calories_per_hour: null,
    exercise_equipment: null,
    exercise_primary_muscles: null,
    exercise_secondary_muscles: null,
    exercise_instructions: null,
    exercise_images: null,
    exercise_source_id: overrides.id,
    exercise_user_id: 'user-1',
    exercise_level: null,
    exercise_force: null,
    exercise_mechanic: null,
    exercise_preset_entry_id: null,
    distance: 4.64,
    steps: null,
    elapsed_time_seconds: 801,
    activity_started_at: null,
    activity_ended_at: null,
    activity_started_at_local: null,
    sets: [],
    ...overrides,
  };
}

describe('workoutDeduplicationService', () => {
  it('keeps direct iGPSPORT workouts and hides overlapping HealthKit mirrors', () => {
    const rows = [
      workoutRow({
        id: 'igps-outbound',
        exercise_source: 'iGPSPORT',
        activity_started_at_local: '2026-08-19T08:45:56',
        elapsed_time_seconds: 1037,
        calories_burned: 119,
      }),
      workoutRow({
        id: 'health-outbound',
        exercise_source: 'HealthKit',
        activity_started_at: '2026-08-19T06:45:56Z',
        activity_ended_at: '2026-08-19T07:03:12Z',
        calories_burned: 119,
      }),
      workoutRow({
        id: 'igps-return',
        exercise_source: 'iGPSPORT',
        activity_started_at_local: '2026-08-19T11:14:52',
        elapsed_time_seconds: 878,
      }),
      workoutRow({
        id: 'health-return',
        exercise_source: 'HealthKit',
        activity_started_at: '2026-08-19T09:14:52Z',
        activity_ended_at: '2026-08-19T09:29:29Z',
      }),
      workoutRow({
        id: 'active-calories',
        exercise_source: 'HealthKit',
        exercise_name: 'Active Calories',
        calories_burned: 587,
        activity_started_at: null,
        elapsed_time_seconds: null,
      }),
    ];

    const canonical = deduplicateWorkoutRows(rows, 'Europe/Berlin');

    expect(canonical.workoutEntries.map((entry) => entry.id)).toEqual([
      'igps-outbound',
      'igps-return',
    ]);
    expect(canonical.duplicateSummary).toEqual({
      hiddenCount: 2,
      hiddenBySource: { HealthKit: 2 },
    });
    expect(calculateExerciseCaloriesByDate(canonical.allEntries)).toEqual([
      { entry_date: '2026-08-19', calories_burned: 587 },
    ]);
    expect(calculateCanonicalWorkoutAggregates(canonical.allEntries)).toEqual({
      total_calories_burned: 237,
      workout_count: 2,
      active_days: 1,
    });
  });

  it('keeps non-overlapping workouts from both providers', () => {
    const canonical = deduplicateWorkoutRows(
      [
        workoutRow({
          id: 'igps-morning',
          exercise_source: 'iGPSPORT',
          activity_started_at_local: '2026-08-19T08:00:00',
        }),
        workoutRow({
          id: 'health-evening',
          exercise_source: 'HealthKit',
          activity_started_at: '2026-08-19T18:00:00Z',
        }),
      ],
      'Europe/Berlin'
    );

    expect(canonical.workoutEntries).toHaveLength(2);
    expect(canonical.duplicateSummary.hiddenCount).toBe(0);
  });

  it('preserves seconds when matching short local-time activities', () => {
    const canonical = deduplicateWorkoutRows(
      [
        workoutRow({
          id: 'igps-short',
          exercise_source: 'iGPSPORT',
          activity_started_at_local: '2026-08-19T08:45:56',
          elapsed_time_seconds: 120,
        }),
        workoutRow({
          id: 'health-short',
          exercise_source: 'HealthKit',
          activity_started_at: '2026-08-19T06:45:56Z',
          elapsed_time_seconds: 120,
        }),
      ],
      'Europe/Berlin'
    );

    expect(canonical.workoutEntries.map((entry) => entry.id)).toEqual([
      'igps-short',
    ]);
  });
});
