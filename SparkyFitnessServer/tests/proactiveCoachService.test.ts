import { beforeEach, describe, expect, it, vi } from 'vitest';
import proactiveCoachService from '../services/proactiveCoachService.js';
import { adaptiveStateSignature } from '../services/proactiveCoachService.js';
import coachProfileRepository, {
  type ProactiveCoachCandidate,
} from '../models/coachProfileRepository.js';
import coachContextService, {
  type CoachContextSnapshot,
} from '../services/coachContextService.js';
import plannedWorkoutScheduleService from '../services/plannedWorkoutScheduleService.js';

vi.mock('../models/coachProfileRepository.js', () => ({
  default: {
    listProactiveCoachCandidates: vi.fn(),
    saveProactiveMessageIfDue: vi.fn(),
    markAdaptiveSlotObserved: vi.fn(),
  },
}));
vi.mock('../services/coachContextService.js', () => ({
  default: {
    getCoachContextSnapshot: vi.fn(),
  },
}));
vi.mock('../services/plannedWorkoutScheduleService.js', () => ({
  default: {
    carryForwardMissedWorkouts: vi.fn(),
  },
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

const candidate: ProactiveCoachCandidate = {
  userId: 'user-1',
  timezone: 'Europe/Berlin',
  language: 'de',
  adaptiveCheckInsEnabled: false,
  adaptiveLastSentSlot: null,
  adaptiveStartTime: '07:00',
  adaptiveEndTime: '20:00',
  adaptiveIntervalMinutes: 120,
  proactiveCategories: ['nutrition', 'hydration', 'training', 'recovery'],
  adaptiveLastSignature: null,
  dailyCheckInEnabled: true,
  dailyCheckInTime: '20:00',
  dailyLastSentOn: null,
  weeklyReviewEnabled: true,
  weeklyReviewDay: 0,
  weeklyReviewTime: '18:00',
  weeklyLastSentOn: null,
};

const snapshot: CoachContextSnapshot = {
  timezone: 'Europe/Berlin',
  today: {
    date: '2026-08-23',
    primaryGoal: 'gain_weight',
    calorieTarget: 3000,
    proteinTargetG: 160,
    waterTargetMl: 3000,
    caloriesConsumed: 1800,
    caloriesBurned: 0,
    netCalories: 1800,
    caloriesRemaining: 1200,
    proteinConsumedG: 110,
    proteinRemainingG: 50,
    waterConsumedMl: 1800,
    waterRemainingMl: 1200,
  },
  week: {
    startDate: '2026-08-17',
    endDate: '2026-08-23',
    totalDays: 7,
    nutritionLoggedDays: 6,
    averageCaloriesOnLoggedDays: 2800,
    averageProteinOnLoggedDaysG: 145,
    averageCalorieTarget: 3000,
    averageProteinTargetG: 160,
    calorieTargetDays: 4,
    waterLoggedDays: 6,
    averageWaterOnLoggedDaysMl: 2700,
    averageWaterTargetMl: 3000,
    workoutCount: 3,
  },
  longTerm: {
    startDate: '2026-07-25',
    endDate: '2026-08-23',
    totalDays: 30,
    nutritionLoggedDays: 25,
    averageCaloriesOnLoggedDays: 2700,
    averageProteinOnLoggedDaysG: 140,
    averageCalorieTarget: 3000,
    averageProteinTargetG: 160,
    calorieTargetDays: 14,
    waterLoggedDays: 24,
    averageWaterOnLoggedDaysMl: 2600,
    averageWaterTargetMl: 3000,
    workoutCount: 12,
  },
  weight30Days: {
    entries: 5,
    firstWeightKg: 80,
    latestWeightKg: 80.8,
    changeKg: 0.8,
  },
  recovery: {
    observedOn: null,
    sleepHours: null,
    sleepScore: null,
    restingHeartRate: null,
    hrvRmssdMs: null,
    vo2Max: null,
    recoveryTimeHours: null,
    trainingReadinessScore: null,
    acuteTrainingLoad: null,
    chronicTrainingLoad: null,
    acwrRatio: null,
    stressLevel: null,
    bodyBatteryHighest: null,
    bodyBatteryLowest: null,
    recentMuscleLoad: [],
  },
  adaptiveTraining: {
    id: '00000000-0000-4000-8000-000000000001',
    date: '2026-08-23',
    kind: 'workout',
    presetId: 1,
    presetName: 'Full Body',
    score: 82,
    status: 'planned',
    volumeFactor: 1,
    rationale: [],
    algorithmVersion: 'adaptive-v1',
    generatedAt: '2026-08-23T06:00:00.000Z',
  },
};

describe('proactiveCoachService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(
      coachProfileRepository.listProactiveCoachCandidates
    ).mockResolvedValue([candidate]);
    vi.mocked(coachContextService.getCoachContextSnapshot).mockResolvedValue(
      snapshot
    );
    vi.mocked(
      plannedWorkoutScheduleService.carryForwardMissedWorkouts
    ).mockResolvedValue([]);
    vi.mocked(
      coachProfileRepository.saveProactiveMessageIfDue
    ).mockResolvedValue(true);
  });

  it('claims local two-hour slots only between 07:00 and 20:00', () => {
    const adaptiveCandidate = {
      ...candidate,
      adaptiveCheckInsEnabled: true,
      dailyCheckInEnabled: false,
      weeklyReviewEnabled: false,
    };

    expect(
      proactiveCoachService.getDueMessageKinds(
        adaptiveCandidate,
        new Date('2026-08-23T05:05:00.000Z')
      )
    ).toEqual(['adaptive']);
    expect(
      proactiveCoachService.getAdaptiveDeliverySlot(
        adaptiveCandidate,
        new Date('2026-08-23T15:45:00.000Z')
      )
    ).toBe('2026-08-23T17:00');
    expect(
      proactiveCoachService.getDueMessageKinds(
        {
          ...adaptiveCandidate,
          adaptiveLastSentSlot: '2026-08-23T17:00',
        },
        new Date('2026-08-23T15:45:00.000Z')
      )
    ).toEqual([]);
    expect(
      proactiveCoachService.getAdaptiveDeliverySlot(
        adaptiveCandidate,
        new Date('2026-08-23T19:01:00.000Z')
      )
    ).toBeNull();
  });

  it('prioritizes a carried-forward planned workout with concrete names', () => {
    const scheduledSnapshot: CoachContextSnapshot = {
      ...snapshot,
      trainingSchedule: {
        dueToday: [
          {
            name: 'Sparky Full Body A',
            date: '2026-08-23',
            workoutPresetId: 44,
            workoutPlanAssignmentId: 9,
            completed: false,
          },
        ],
        completedToday: [],
        missedYesterday: [
          {
            name: 'Sparky Full Body A',
            date: '2026-08-22',
            workoutPresetId: 44,
            workoutPlanAssignmentId: 9,
            completed: false,
          },
        ],
        carriedForwardToday: [],
      },
    };

    const message = proactiveCoachService.renderAdaptiveCoachMessage(
      scheduledSnapshot,
      'de',
      '2026-08-23T07:00',
      ['training']
    );

    expect(message).toContain('Sparky Full Body A');
    expect(message).toContain('gestern nicht absolviert');
    expect(
      adaptiveStateSignature(
        scheduledSnapshot,
        ['training'],
        '2026-08-23T07:00'
      )
    ).not.toBe(
      adaptiveStateSignature(snapshot, ['training'], '2026-08-23T07:00')
    );
  });

  it('renders current values and a concrete adaptive action', () => {
    const message = proactiveCoachService.renderAdaptiveCoachMessage(
      snapshot,
      'de',
      '2026-08-23T17:00'
    );

    expect(message).toContain('1800 kcal gegessen');
    expect(message).toContain('110 / 160 g');
    expect(message).toContain('50 g Protein');
  });

  it('respects local time and weekday schedules', () => {
    expect(
      proactiveCoachService.getDueMessageKinds(
        candidate,
        new Date('2026-08-23T18:15:00.000Z')
      )
    ).toEqual(['daily', 'weekly']);
    expect(
      proactiveCoachService.getDueMessageKinds(
        candidate,
        new Date('2026-08-23T15:00:00.000Z')
      )
    ).toEqual([]);
    expect(
      proactiveCoachService.getDueMessageKinds(
        { ...candidate, dailyLastSentOn: '2026-08-23' },
        new Date('2026-08-23T18:15:00.000Z')
      )
    ).toEqual(['weekly']);
  });

  it('writes idempotent daily and weekly assistant messages', async () => {
    const delivered =
      await proactiveCoachService.processDueProactiveCoachMessages(
        new Date('2026-08-23T18:15:00.000Z')
      );

    expect(delivered).toBe(2);
    expect(
      coachProfileRepository.saveProactiveMessageIfDue
    ).toHaveBeenCalledWith(
      'user-1',
      'daily',
      '2026-08-23',
      expect.stringContaining('täglicher Coach-Check-in'),
      undefined
    );
    expect(
      coachProfileRepository.saveProactiveMessageIfDue
    ).toHaveBeenCalledWith(
      'user-1',
      'weekly',
      '2026-08-23',
      expect.stringContaining('Wochenrückblick'),
      undefined
    );
  });

  it('isolates an invalid user timezone from other scheduled users', async () => {
    vi.mocked(
      coachProfileRepository.listProactiveCoachCandidates
    ).mockResolvedValue([
      { ...candidate, userId: 'invalid-user', timezone: 'Invalid/Timezone' },
      candidate,
    ]);

    const delivered =
      await proactiveCoachService.processDueProactiveCoachMessages(
        new Date('2026-08-23T18:15:00.000Z')
      );

    expect(delivered).toBe(2);
    expect(coachContextService.getCoachContextSnapshot).toHaveBeenCalledTimes(
      1
    );
  });
});
