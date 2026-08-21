import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '@workspace/shared';
import coachContextService from '../services/coachContextService.js';
import onboardingRepository from '../models/onboardingRepository.js';
import preferenceRepository from '../models/preferenceRepository.js';
import foodRepository from '../models/foodMisc.js';
import measurementRepository from '../models/measurementRepository.js';
import coachRepository from '../models/coachRepository.js';
import goalService from '../services/goalService.js';
import workoutDeduplicationService from '../services/workoutDeduplicationService.js';
import { getDailySummary } from '../services/dailySummaryService.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';
import adaptiveTrainingService from '../services/adaptiveTrainingService.js';
import plannedWorkoutScheduleService from '../services/plannedWorkoutScheduleService.js';

vi.mock('../models/onboardingRepository.js', () => ({
  default: { getOnboardingGoalData: vi.fn() },
}));
vi.mock('../models/preferenceRepository.js', () => ({
  default: { getUserPreferences: vi.fn() },
}));
vi.mock('../models/foodMisc.js', () => ({
  default: { getDailyNutritionSummariesByDates: vi.fn() },
}));
vi.mock('../models/measurementRepository.js', () => ({
  default: { getWaterIntakesByDates: vi.fn() },
}));
vi.mock('../models/coachRepository.js', () => ({
  default: {
    getExerciseAggregates: vi.fn(),
    getWeightSeries: vi.fn(),
    getRecoverySignals: vi.fn(),
  },
}));
vi.mock('../services/goalService.js', () => ({
  default: {
    getUserGoals: vi.fn(),
    getUserGoalsForRange: vi.fn(),
  },
}));
vi.mock('../services/workoutDeduplicationService.js', () => ({
  default: { getCanonicalWorkoutAggregates: vi.fn() },
}));
vi.mock('../services/dailySummaryService.js', () => ({
  getDailySummary: vi.fn(),
}));
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn(),
}));
vi.mock('../services/adaptiveTrainingService.js', () => ({
  default: { getAdaptiveTrainingDashboard: vi.fn() },
}));
vi.mock('../services/plannedWorkoutScheduleService.js', () => ({
  default: {
    getPlannedWorkoutScheduleStatus: vi.fn(),
    getTrainingTimeline: vi.fn(),
  },
}));

describe('coachContextService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T12:00:00.000Z'));
    vi.mocked(loadUserTimezone).mockResolvedValue('Europe/Berlin');
    vi.mocked(
      plannedWorkoutScheduleService.getPlannedWorkoutScheduleStatus
    ).mockResolvedValue({
      dueToday: [],
      completedToday: [],
      missedYesterday: [],
      carriedForwardToday: [],
    });
    vi.mocked(
      plannedWorkoutScheduleService.getTrainingTimeline
    ).mockResolvedValue({
      today: '2026-08-18',
      rangeStart: '2026-07-19',
      rangeEnd: '2026-12-16',
      activePlans: [
        {
          id: 1,
          name: 'Sparky Muskelaufbau',
          description: null,
          startDate: '2026-08-24',
          endDate: '2026-10-18',
          assignments: [
            {
              dayOfWeek: 1,
              presetId: 44,
              workoutName: 'Full Body A',
              exerciseCount: 7,
              totalSetCount: 18,
              warmupSetCount: 0,
              workingSetCount: 18,
            },
          ],
        },
      ],
      items: [
        {
          id: 'planned-1',
          date: '2026-08-24',
          name: 'Full Body A',
          source: 'Workout Plan',
          status: 'planned',
          workoutPresetId: 44,
          workoutPlanAssignmentId: 9,
          exerciseCount: 7,
          totalSetCount: 18,
          warmupSetCount: 0,
          workingSetCount: 18,
        },
      ],
      days: [
        {
          date: '2026-08-18',
          status: 'in_progress',
          scheduledWorkoutCount: 1,
          completedScheduledWorkoutCount: 0,
          completedWorkoutCount: 0,
          scheduledExerciseCount: 7,
          completedScheduledExerciseCount: 2,
          scheduledSetCount: 18,
          completedScheduledSetCount: 5,
          scheduledWarmupSetCount: 2,
          completedScheduledWarmupSetCount: 2,
          scheduledNames: ['Full Body A'],
          completedNames: [],
          sources: [],
        },
      ],
    });
    vi.mocked(onboardingRepository.getOnboardingGoalData).mockResolvedValue({
      primary_goal: 'gain_weight',
    });
    vi.mocked(preferenceRepository.getUserPreferences).mockResolvedValue({
      goal_mode: 'lean_bulk',
    });
    vi.mocked(goalService.getUserGoals).mockResolvedValue({
      calories: 3000,
      protein: 160,
      water_goal_ml: 3000,
    });
    vi.mocked(coachRepository.getRecoverySignals).mockResolvedValue({
      health: null,
      sleep: null,
      hrv: null,
      muscles: [],
    });
    vi.mocked(
      adaptiveTrainingService.getAdaptiveTrainingDashboard
    ).mockResolvedValue({
      date: '2026-08-18',
      settings: {
        enabled: true,
        sessionsPerWeek: 3,
        maxDurationMinutes: 45,
        recoveryWindowHours: 72,
        preferredMuscles: [],
        candidateWorkoutPresetIds: [],
        avoidConsecutiveTrainingDays: true,
      },
      readiness: {
        score: 75,
        sleepHours: 7.5,
        sleepScore: 80,
        trainingReadinessScore: 70,
      },
      muscleLoad: [],
      recommendation: {
        id: '00000000-0000-4000-8000-000000000001',
        date: '2026-08-18',
        kind: 'workout',
        presetId: 1,
        presetName: 'Full Body',
        score: 82,
        status: 'planned',
        volumeFactor: 1,
        rationale: [],
        algorithmVersion: 'adaptive-v1',
        generatedAt: '2026-08-18T06:00:00.000Z',
      },
      availablePresets: [],
      hiddenDuplicateWorkouts: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('inherits the current goal mode and dated goals', async () => {
    await expect(
      coachContextService.getCanonicalCoachGoals('user-1')
    ).resolves.toEqual({
      primaryGoal: 'gain_weight',
      calorieTarget: 3000,
      proteinTargetG: 160,
      waterTargetMl: 3000,
    });
  });

  it('builds today, seven-day, and 30-day progress from canonical data', async () => {
    const today = '2026-08-18';
    const longStart = addDays(today, -29);
    const goals: Record<string, Record<string, number>> = {};
    for (let date = longStart; date <= today; date = addDays(date, 1)) {
      goals[date] = { calories: 3000, protein: 160, water_goal_ml: 3000 };
    }
    vi.mocked(goalService.getUserGoalsForRange).mockResolvedValue(goals);
    vi.mocked(getDailySummary).mockResolvedValue({
      goals: goals[today],
      foodEntries: [
        { protein: 40, quantity: 100, serving_size: 100, calories: 500 },
      ],
      exerciseSessions: [],
      waterIntake: 1800,
      stepCalories: 0,
      calorieBalance: {
        eaten: 1800,
        burned: 425,
        remaining: 1625,
        goal: 3000,
        net: 1375,
        progress: 60,
        bmr: 0,
        bmrSource: 'formula',
        exerciseSource: 'none',
        tdeeProjection: null,
      },
      adjustedGoals: null,
      supplementTotals: {
        calories: 100,
        protein: 10,
        carbs: 0,
        fat: 0,
        dietary_fiber: 0,
      },
    } as never);
    vi.mocked(
      foodRepository.getDailyNutritionSummariesByDates
    ).mockResolvedValue([
      {
        entry_date: addDays(today, -1),
        total_calories: 2900,
        total_protein: 150,
      },
      {
        entry_date: today,
        total_calories: 1800,
        total_protein: 50,
      },
    ]);
    vi.mocked(measurementRepository.getWaterIntakesByDates).mockResolvedValue([
      { entry_date: addDays(today, -1), water_ml: 3000 },
      { entry_date: today, water_ml: 1800 },
    ]);
    vi.mocked(workoutDeduplicationService.getCanonicalWorkoutAggregates)
      .mockResolvedValueOnce({
        workout_count: 3,
        total_calories_burned: 0,
        active_days: 2,
      })
      .mockResolvedValueOnce({
        workout_count: 11,
        total_calories_burned: 0,
        active_days: 9,
      });
    vi.mocked(coachRepository.getWeightSeries).mockResolvedValue([
      { entry_date: longStart, weight: 80 },
      { entry_date: today, weight: 81.2 },
    ]);

    const snapshot =
      await coachContextService.getCoachContextSnapshot('user-1');

    expect(snapshot.today).toEqual(
      expect.objectContaining({
        caloriesConsumed: 1800,
        caloriesBurned: 425,
        netCalories: 1375,
        caloriesRemaining: 1625,
        proteinConsumedG: 50,
        proteinRemainingG: 110,
        waterRemainingMl: 1200,
      })
    );
    expect(snapshot.week).toEqual(
      expect.objectContaining({
        nutritionLoggedDays: 2,
        averageCaloriesOnLoggedDays: 2350,
        calorieTargetDays: 1,
        workoutCount: 3,
      })
    );
    expect(snapshot.longTerm.workoutCount).toBe(11);
    expect(snapshot.weight30Days.changeKg).toBe(1.2);
    expect(coachContextService.formatCoachContext(snapshot)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'Today so far: 1800 kcal food/supplement intake; 425 kcal burned'
        ),
        expect.stringContaining(
          'Never add calories, water, protein, or other values from chat history'
        ),
        expect.stringContaining('Last 7 days'),
        expect.stringContaining('Last 30 days'),
        expect.stringContaining('+1.2 kg'),
        expect.stringContaining('0 warm-up sets'),
        expect.stringContaining('scheduled sets 5/18'),
        expect.stringContaining('2026-08-24 planned Full Body A'),
      ])
    );
  });
});
