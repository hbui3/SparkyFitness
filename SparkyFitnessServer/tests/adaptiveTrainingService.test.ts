import { beforeEach, describe, expect, it, vi } from 'vitest';
import adaptiveTrainingService from '../services/adaptiveTrainingService.js';
import adaptiveTrainingRepository from '../models/adaptiveTrainingRepository.js';
import { getCanonicalWorkoutEntries } from '../services/workoutDeduplicationService.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';

vi.mock('../models/adaptiveTrainingRepository.js', () => ({
  default: {
    getSettings: vi.fn(),
    upsertSettings: vi.fn(),
    getPresetRows: vi.fn(),
    getReadiness: vi.fn(),
    getRecommendation: vi.fn(),
    saveRecommendation: vi.fn(),
    updateRecommendationStatus: vi.fn(),
  },
}));
vi.mock('../services/workoutDeduplicationService.js', () => ({
  getCanonicalWorkoutEntries: vi.fn(),
}));
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn(),
}));

const presetRows = [
  {
    preset_id: 1,
    preset_name: 'Chest Day',
    preset_description: null,
    preset_exercise_id: 10,
    exercise_name: 'Bench Press',
    primary_muscles: '["chest"]',
    secondary_muscles: '["triceps"]',
    sets: [{ reps: 10, weight: 60, duration: null, rest_time: 90 }],
  },
  {
    preset_id: 2,
    preset_name: 'Back Day',
    preset_description: null,
    preset_exercise_id: 20,
    exercise_name: 'Row',
    primary_muscles: '["back"]',
    secondary_muscles: '["biceps"]',
    sets: [{ reps: 10, weight: 60, duration: null, rest_time: 90 }],
  },
];

describe('adaptiveTrainingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadUserTimezone).mockResolvedValue('Europe/Berlin');
    vi.mocked(adaptiveTrainingRepository.getSettings).mockResolvedValue(null);
    vi.mocked(adaptiveTrainingRepository.getPresetRows).mockResolvedValue(
      presetRows
    );
    vi.mocked(adaptiveTrainingRepository.getReadiness).mockResolvedValue({
      sleep_hours: 8,
      sleep_score: 85,
      training_readiness_score: 80,
    });
    vi.mocked(adaptiveTrainingRepository.getRecommendation).mockResolvedValue(
      null
    );
    vi.mocked(getCanonicalWorkoutEntries).mockResolvedValue({
      allEntries: [],
      workoutEntries: [],
      duplicateSummary: { hiddenCount: 2, hiddenBySource: { HealthKit: 2 } },
    });
    vi.mocked(adaptiveTrainingRepository.saveRecommendation).mockImplementation(
      async (_userId, _authenticatedUserId, input) => ({
        id: '00000000-0000-4000-8000-000000000001',
        recommendation_date: input.date,
        kind: input.kind,
        workout_preset_id: input.workoutPresetId,
        status: 'planned',
        score: input.score,
        volume_factor: input.volumeFactor,
        muscle_load_snapshot: input.muscleLoadSnapshot,
        workout_snapshot: input.workoutSnapshot,
        rationale: input.rationale,
        algorithm_version: input.algorithmVersion,
        generated_at: '2026-08-19T06:00:00.000Z',
      })
    );
  });

  it('prioritizes preferred muscles and exposes canonical duplicate suppression', async () => {
    vi.mocked(adaptiveTrainingRepository.getSettings).mockResolvedValue({
      user_id: '00000000-0000-4000-8000-000000000100',
      enabled: true,
      sessions_per_week: 3,
      max_duration_minutes: 45,
      recovery_window_hours: 72,
      preferred_muscles: ['back'],
      candidate_workout_preset_ids: [],
      avoid_consecutive_training_days: true,
    });

    const dashboard =
      await adaptiveTrainingService.getAdaptiveTrainingDashboard(
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000100',
        '2026-08-19'
      );

    expect(dashboard.recommendation.kind).toBe('workout');
    expect(dashboard.recommendation.presetName).toBe('Back Day');
    expect(dashboard.recommendation.rationale).toContainEqual(
      expect.objectContaining({
        code: 'preferred_muscles',
        muscles: ['back'],
      })
    );
    expect(dashboard.hiddenDuplicateWorkouts).toBe(2);
    expect(getCanonicalWorkoutEntries).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000100',
      '2026-08-13',
      '2026-08-19'
    );
    expect(
      adaptiveTrainingRepository.saveRecommendation
    ).toHaveBeenCalledOnce();
  });

  it('keeps an unchanged planned recommendation when JSON object key order differs', async () => {
    vi.mocked(adaptiveTrainingRepository.getRecommendation).mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000099',
      recommendation_date: '2026-08-19',
      kind: 'workout',
      workout_preset_id: 1,
      status: 'planned',
      score: 90,
      volume_factor: 1,
      muscle_load_snapshot: {
        settings: {
          avoidConsecutiveTrainingDays: true,
          candidateWorkoutPresetIds: [],
          preferredMuscles: [],
          recoveryWindowHours: 72,
          maxDurationMinutes: 45,
          sessionsPerWeek: 3,
          enabled: true,
        },
        eligiblePresetIds: [2, 1],
        readiness: {
          trainingReadinessScore: 80,
          sleepScore: 85,
          sleepHours: 8,
          score: 88,
        },
        trainedYesterday: false,
        weekStrengthSessionCount: 0,
        muscleLoad: [],
      },
      workout_snapshot: { name: 'Chest Day' },
      rationale: [{ code: 'muscles_ready', muscles: ['chest'], value: 100 }],
      algorithm_version: 'adaptive-v1',
      generated_at: '2026-08-19T06:00:00.000Z',
    });

    const dashboard =
      await adaptiveTrainingService.getAdaptiveTrainingDashboard(
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000100',
        '2026-08-19'
      );

    expect(dashboard.recommendation.id).toBe(
      '00000000-0000-4000-8000-000000000099'
    );
    expect(
      adaptiveTrainingRepository.saveRecommendation
    ).not.toHaveBeenCalled();
  });

  it('calculates a read-only recommendation without persisting it', async () => {
    const dashboard =
      await adaptiveTrainingService.getAdaptiveTrainingDashboard(
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000200',
        '2026-08-19',
        { persistRecommendation: false }
      );

    expect(dashboard.recommendation.kind).toBe('workout');
    expect(dashboard.recommendation.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(
      adaptiveTrainingRepository.saveRecommendation
    ).not.toHaveBeenCalled();
  });

  it('returns recovery when wearable readiness is too low', async () => {
    vi.mocked(adaptiveTrainingRepository.getReadiness).mockResolvedValue({
      sleep_hours: 4,
      sleep_score: 30,
      training_readiness_score: 25,
    });

    const dashboard =
      await adaptiveTrainingService.getAdaptiveTrainingDashboard(
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000100',
        '2026-08-19'
      );

    expect(dashboard.recommendation).toEqual(
      expect.objectContaining({ kind: 'recovery', presetId: null })
    );
    expect(dashboard.recommendation.rationale[0]?.code).toBe('low_readiness');
  });

  it('rejects preset ids that do not belong to the active user', async () => {
    await expect(
      adaptiveTrainingService.updateAdaptiveTrainingSettings(
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000100',
        {
          enabled: true,
          sessionsPerWeek: 3,
          maxDurationMinutes: 45,
          recoveryWindowHours: 72,
          preferredMuscles: [],
          candidateWorkoutPresetIds: [999],
          avoidConsecutiveTrainingDays: true,
        },
        '2026-08-19'
      )
    ).rejects.toThrow('Workout preset 999 is not available');
  });
});
