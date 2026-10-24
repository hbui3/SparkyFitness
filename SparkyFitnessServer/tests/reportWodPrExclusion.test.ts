import { describe, it, expect, vi, beforeEach } from 'vitest';
import reportService from '../services/reportService.js';
import reportRepository from '../models/reportRepository.js';

vi.mock('../models/reportRepository.js');
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn().mockResolvedValue('UTC'),
}));

const TEST_USER_ID = '00000000-0000-4000-a000-000000000001';

describe('reportService: interval/WOD format strength PR exclusion', () => {
  beforeEach(() => {
    vi.mocked(reportRepository.getBodyWeightReadings).mockResolvedValue([]);
    vi.clearAllMocks();
  });

  it('excludes AMRAP sets from 1RM PRs, best-set-per-rep-range, and PR progression while keeping volume and reps', async () => {
    vi.mocked(reportRepository.getExerciseEntries).mockResolvedValue([
      {
        id: 'entry-amrap',
        entry_date: '2026-09-20',
        exercise_name: 'Thruster',
        workout_format: 'amrap',
        sets: [
          { set_number: 1, weight: 60, reps: 20 },
          { set_number: 2, weight: 60, reps: 15 },
        ],
        exercises: {
          primary_muscles: JSON.stringify(['quadriceps', 'shoulders']),
        },
      },
    ] as unknown as Awaited<
      ReturnType<typeof reportRepository.getExerciseEntries>
    >);

    const report = await reportService.getExerciseDashboardData(
      TEST_USER_ID,
      TEST_USER_ID,
      '2026-09-01',
      '2026-09-30',
      null,
      null,
      null
    );

    // PR metrics must NOT include the AMRAP sets
    expect(report.prData['Thruster']).toBeUndefined();
    expect(report.bestSetRepRange['Thruster']).toBeUndefined();
    expect(report.prProgressionData['Thruster']).toBeUndefined();

    // Volume, reps, workouts, and muscle group volume MUST still count the work
    const expectedVolume = 60 * 20 + 60 * 15; // 1200 + 900 = 2100
    expect(report.keyStats.totalVolume).toBe(expectedVolume);
    expect(report.keyStats.totalReps).toBe(35);
    expect(report.keyStats.totalWorkouts).toBe(1);
    expect(report.muscleGroupVolume['Quadriceps']).toBe(expectedVolume);
    expect(report.muscleGroupVolume['Shoulders']).toBe(expectedVolume);
  });

  it('excludes Tabata, EMOM, and For Time formats from PR calculations', async () => {
    vi.mocked(reportRepository.getExerciseEntries).mockResolvedValue([
      {
        id: 'entry-tabata',
        entry_date: '2026-09-21',
        exercise_name: 'Kettlebell Swing',
        workout_format: 'tabata',
        sets: [{ set_number: 1, weight: 32, reps: 12 }],
      },
      {
        id: 'entry-emom',
        entry_date: '2026-09-22',
        exercise_name: 'Deadlift',
        workout_format: 'emom',
        sets: [{ set_number: 1, weight: 140, reps: 5 }],
      },
      {
        id: 'entry-for-time',
        entry_date: '2026-09-23',
        exercise_name: 'Clean and Jerk',
        workout_format: 'for_time',
        sets: [{ set_number: 1, weight: 80, reps: 10 }],
      },
    ] as unknown as Awaited<
      ReturnType<typeof reportRepository.getExerciseEntries>
    >);

    const report = await reportService.getExerciseDashboardData(
      TEST_USER_ID,
      TEST_USER_ID,
      '2026-09-01',
      '2026-09-30',
      null,
      null,
      null
    );

    expect(report.prData['Kettlebell Swing']).toBeUndefined();
    expect(report.prData['Deadlift']).toBeUndefined();
    expect(report.prData['Clean and Jerk']).toBeUndefined();

    expect(report.prProgressionData['Kettlebell Swing']).toBeUndefined();
    expect(report.prProgressionData['Deadlift']).toBeUndefined();
    expect(report.prProgressionData['Clean and Jerk']).toBeUndefined();

    expect(report.keyStats.totalWorkouts).toBe(3);
    expect(report.keyStats.totalVolume).toBe(32 * 12 + 140 * 5 + 80 * 10);
    expect(report.keyStats.totalReps).toBe(12 + 5 + 10);
  });

  it('calculates 1RM PRs, best-set-per-rep-range, and PR progression for standard workouts', async () => {
    vi.mocked(reportRepository.getExerciseEntries).mockResolvedValue([
      {
        id: 'entry-standard',
        entry_date: '2026-09-15',
        exercise_name: 'Bench Press',
        workout_format: 'standard',
        sets: [
          { set_number: 1, weight: 100, reps: 5 },
          { set_number: 2, weight: 110, reps: 3 },
        ],
      },
    ] as unknown as Awaited<
      ReturnType<typeof reportRepository.getExerciseEntries>
    >);

    const report = await reportService.getExerciseDashboardData(
      TEST_USER_ID,
      TEST_USER_ID,
      '2026-09-01',
      '2026-09-30',
      null,
      null,
      null
    );

    // Standard format PRs are calculated
    expect(report.prData['Bench Press']).toBeDefined();
    expect(report.prData['Bench Press'].weight).toBe(110);
    expect(report.prData['Bench Press'].reps).toBe(3);

    expect(report.bestSetRepRange['Bench Press']).toBeDefined();
    expect(report.prProgressionData['Bench Press']).toHaveLength(2);
  });

  it('treats entries with no workout_format (null/undefined ad-hoc or legacy imports) as standard', async () => {
    vi.mocked(reportRepository.getExerciseEntries).mockResolvedValue([
      {
        id: 'entry-adhoc',
        entry_date: '2026-09-10',
        exercise_name: 'Squat',
        // workout_format omitted / null
        sets: [{ set_number: 1, weight: 150, reps: 5 }],
      },
    ] as unknown as Awaited<
      ReturnType<typeof reportRepository.getExerciseEntries>
    >);

    const report = await reportService.getExerciseDashboardData(
      TEST_USER_ID,
      TEST_USER_ID,
      '2026-09-01',
      '2026-09-30',
      null,
      null,
      null
    );

    // Ad-hoc entry defaults to standard and calculates PRs
    expect(report.prData['Squat']).toBeDefined();
    expect(report.prData['Squat'].weight).toBe(150);
    expect(report.prData['Squat'].reps).toBe(5);
    expect(report.prProgressionData['Squat']).toBeDefined();
    expect(report.prProgressionData['Squat']).toHaveLength(1);
  });

  it('preserves standard strength PR when a later AMRAP session has heavier/more reps', async () => {
    vi.mocked(reportRepository.getExerciseEntries).mockResolvedValue([
      {
        id: 'entry-standard',
        entry_date: '2026-09-10',
        exercise_name: 'Deadlift',
        workout_format: 'standard',
        sets: [{ set_number: 1, weight: 180, reps: 5 }],
      },
      {
        id: 'entry-amrap',
        entry_date: '2026-09-20',
        exercise_name: 'Deadlift',
        workout_format: 'amrap',
        sets: [{ set_number: 1, weight: 100, reps: 25 }],
      },
    ] as unknown as Awaited<
      ReturnType<typeof reportRepository.getExerciseEntries>
    >);

    const report = await reportService.getExerciseDashboardData(
      TEST_USER_ID,
      TEST_USER_ID,
      '2026-09-01',
      '2026-09-30',
      null,
      null,
      null
    );

    // PR must stay on the standard 180kg set, not the AMRAP 100kg x 25 set
    expect(report.prData['Deadlift'].weight).toBe(180);
    expect(report.prData['Deadlift'].reps).toBe(5);
    expect(report.prData['Deadlift'].date).toBe('2026-09-10');

    // Progression should only have the standard entry
    expect(report.prProgressionData['Deadlift']).toHaveLength(1);
    expect(report.prProgressionData['Deadlift'][0].maxWeight).toBe(180);

    // Total volume combines both
    expect(report.keyStats.totalVolume).toBe(180 * 5 + 100 * 25);
  });

  it('counts body weight plus the added or assisting weight for a bodyweight exercise', async () => {
    vi.mocked(reportRepository.getBodyWeightReadings).mockResolvedValue([
      { date: '2026-09-01', weightKg: 80 },
    ]);
    vi.mocked(reportRepository.getExerciseEntries).mockResolvedValue([
      {
        id: 'entry-dips',
        entry_date: '2026-09-15',
        exercise_name: 'Dips',
        exercise_category: 'strength',
        exercise_modality: 'bodyweight_reps',
        workout_format: 'standard',
        sets: [
          { set_number: 1, weight: 20, reps: 8 }, // weighted: 100 kg moved
          { set_number: 2, weight: -30, reps: 10 }, // assisted: 50 kg moved
        ],
        exercises: { primary_muscles: JSON.stringify(['triceps']) },
      },
    ] as unknown as Awaited<
      ReturnType<typeof reportRepository.getExerciseEntries>
    >);

    const report = await reportService.getExerciseDashboardData(
      TEST_USER_ID,
      TEST_USER_ID,
      '2026-09-01',
      '2026-09-30',
      null,
      null,
      null
    );

    expect(report.keyStats.totalVolume).toBe(100 * 8 + 50 * 10);
    expect(report.muscleGroupVolume['Triceps']).toBe(100 * 8 + 50 * 10);
    // The PR is ranked on the load moved, not the 20 kg on the belt.
    expect(report.prData['Dips'].weight).toBe(100);
    expect(report.prData['Dips'].oneRM).toBeCloseTo(100 * (1 + 8 / 30));
    expect(report.prProgressionData['Dips'][0].maxWeight).toBe(100);
  });
});
