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
import { composeAdaptiveCoachMessage } from '../services/proactiveCoachMessageService.js';
import {
  getCoachMealSuggestion,
  type CoachMealSuggestion,
} from '../services/coachMealSuggestionService.js';
import { getRestockReminder } from '../services/coachMealPlanningService.js';

vi.mock('../models/coachProfileRepository.js', () => ({
  default: {
    listProactiveCoachCandidates: vi.fn(),
    listRecentProactiveMessages: vi.fn(),
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
vi.mock('../services/proactiveCoachMessageService.js', () => ({
  composeAdaptiveCoachMessage: vi.fn(),
}));
vi.mock('../services/coachMealSuggestionService.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../services/coachMealSuggestionService.js')
    >();
  return {
    ...actual,
    getCoachMealSuggestion: vi.fn(),
  };
});
vi.mock('../services/coachMealPlanningService.js', () => ({
  getRestockReminder: vi.fn(),
}));

const mealSuggestion: CoachMealSuggestion = {
  id: 'chicken-rice-bowl',
  nameDe: 'Hähnchen-Reis-Gemüse-Bowl',
  nameEn: 'Chicken, rice, and vegetable bowl',
  calories: 670,
  proteinG: 56,
  carbsG: 74,
  fatG: 17,
  mealSlots: ['lunch', 'dinner'],
  ingredients: [
    {
      nameDe: 'Hähnchenbrust',
      nameEn: 'chicken breast',
      amount: 180,
      unit: 'g',
      category: 'chilled',
    },
    {
      nameDe: 'Reis, trocken',
      nameEn: 'dry rice',
      amount: 80,
      unit: 'g',
      category: 'pantry',
    },
  ],
  preparationDe: 'Reis kochen und das Hähnchen anbraten.',
  preparationEn: 'Cook the rice and pan-fry the chicken.',
  shoppingServings: 2,
};

const candidate: ProactiveCoachCandidate = {
  userId: 'user-1',
  timezone: 'Europe/Berlin',
  language: 'de',
  adaptiveCheckInsEnabled: false,
  adaptiveLastObservedSlot: null,
  adaptiveStartTime: '07:00',
  adaptiveEndTime: '20:00',
  adaptiveIntervalMinutes: 120,
  proactiveCategories: ['nutrition', 'hydration', 'training', 'recovery'],
  adaptiveLastSignature: null,
  adaptiveCooldownLastMessageAt: null,
  lastUserMessageAt: null,
  coachingNotes: null,
  routines: [],
  memoryEnabled: true,
  dailyCheckInEnabled: true,
  dailyCheckInTime: '20:00',
  dailyLastSentOn: null,
  restockLastSentOn: null,
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
    vi.mocked(
      coachProfileRepository.listRecentProactiveMessages
    ).mockResolvedValue([]);
    vi.mocked(composeAdaptiveCoachMessage).mockResolvedValue(
      'Das Training wartet. Lege jetzt deine Startzeit fest.'
    );
    vi.mocked(getCoachMealSuggestion).mockResolvedValue(null);
    vi.mocked(getRestockReminder).mockResolvedValue(null);
  });

  it('creates stable staggered observation slots every three to eight minutes', () => {
    const adaptiveCandidate = {
      ...candidate,
      adaptiveCheckInsEnabled: true,
      dailyCheckInEnabled: false,
      weeklyReviewEnabled: false,
    };

    expect(
      proactiveCoachService.getDueMessageKinds(
        adaptiveCandidate,
        new Date('2026-08-23T05:08:00.000Z')
      )
    ).toEqual(['adaptive']);
    const observedSlot = proactiveCoachService.getAdaptiveDeliverySlot(
      adaptiveCandidate,
      new Date('2026-08-23T15:45:00.000Z')
    );
    expect(observedSlot).toMatch(/^2026-08-23T17:[0-4]\d$/);
    expect(
      proactiveCoachService.getAdaptiveDeliverySlot(
        adaptiveCandidate,
        new Date('2026-08-23T15:45:00.000Z')
      )
    ).toBe(observedSlot);
    const firstHourSlots = new Set<string>();
    for (let minute = 0; minute <= 59; minute += 1) {
      const slot = proactiveCoachService.getAdaptiveDeliverySlot(
        adaptiveCandidate,
        new Date(`2026-08-23T05:${String(minute).padStart(2, '0')}:00.000Z`)
      );
      if (slot) firstHourSlots.add(slot);
    }
    const slotMinutes = [...firstHourSlots].map((slot) =>
      Number(slot.slice(-2))
    );
    for (let index = 1; index < slotMinutes.length; index += 1) {
      expect(
        slotMinutes[index] - slotMinutes[index - 1]
      ).toBeGreaterThanOrEqual(3);
      expect(slotMinutes[index] - slotMinutes[index - 1]).toBeLessThanOrEqual(
        8
      );
    }
    expect(
      proactiveCoachService.getDueMessageKinds(
        {
          ...adaptiveCandidate,
          adaptiveLastObservedSlot: observedSlot,
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

  it('sends a relevant adaptive message with topic metadata', async () => {
    vi.mocked(
      coachProfileRepository.listProactiveCoachCandidates
    ).mockResolvedValue([
      {
        ...candidate,
        adaptiveCheckInsEnabled: true,
        dailyCheckInEnabled: false,
        weeklyReviewEnabled: false,
      },
    ]);

    const delivered =
      await proactiveCoachService.processDueProactiveCoachMessages(
        new Date('2026-08-23T15:45:00.000Z')
      );

    expect(delivered).toBe(1);
    expect(composeAdaptiveCoachMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        opportunity: expect.objectContaining({ topic: 'training' }),
      })
    );
    expect(
      coachProfileRepository.saveProactiveMessageIfDue
    ).toHaveBeenCalledWith(
      'user-1',
      'adaptive',
      expect.stringMatching(/^2026-08-23T17:/),
      'Das Training wartet. Lege jetzt deine Startzeit fest.',
      expect.any(String),
      expect.objectContaining({ topic: 'training', score: 88 })
    );
  });

  it('honors a persisted restock timestamp in the adaptive global cooldown', async () => {
    vi.mocked(
      coachProfileRepository.listProactiveCoachCandidates
    ).mockResolvedValue([
      {
        ...candidate,
        adaptiveCheckInsEnabled: true,
        adaptiveCooldownLastMessageAt: '2026-08-23T15:30:00.000Z',
        dailyCheckInEnabled: false,
        restockLastSentOn: '2026-08-23',
        weeklyReviewEnabled: false,
      },
    ]);

    const delivered =
      await proactiveCoachService.processDueProactiveCoachMessages(
        new Date('2026-08-23T15:45:00.000Z')
      );

    expect(delivered).toBe(0);
    expect(composeAdaptiveCoachMessage).not.toHaveBeenCalled();
    expect(
      coachProfileRepository.markAdaptiveSlotObserved
    ).toHaveBeenCalledWith('user-1', expect.stringMatching(/^2026-08-23T17:/));
  });

  it('honors a recent restock message in the adaptive nutrition topic cooldown', async () => {
    vi.mocked(
      coachProfileRepository.listProactiveCoachCandidates
    ).mockResolvedValue([
      {
        ...candidate,
        adaptiveCheckInsEnabled: true,
        adaptiveCooldownLastMessageAt: '2026-08-23T13:00:00.000Z',
        dailyCheckInEnabled: false,
        restockLastSentOn: '2026-08-23',
        weeklyReviewEnabled: false,
        proactiveCategories: ['nutrition'],
      },
    ]);
    vi.mocked(coachContextService.getCoachContextSnapshot).mockResolvedValue({
      ...snapshot,
      today: {
        ...snapshot.today,
        caloriesConsumed: 0,
        netCalories: 0,
        caloriesRemaining: 3000,
        proteinConsumedG: 0,
        proteinRemainingG: 160,
      },
      week: {
        ...snapshot.week,
        nutritionLoggedDays: 0,
        workoutCount: 0,
      },
      weight30Days: {
        ...snapshot.weight30Days,
        entries: 0,
        changeKg: null,
      },
    });
    vi.mocked(
      coachProfileRepository.listRecentProactiveMessages
    ).mockResolvedValue([
      {
        content: 'Reis und Brokkoli fehlen noch.',
        topic: 'nutrition',
        stateSignature: 'reis-brokkoli',
        createdAt: '2026-08-23T13:00:00.000Z',
      },
    ]);

    const delivered =
      await proactiveCoachService.processDueProactiveCoachMessages(
        new Date('2026-08-23T15:45:00.000Z')
      );

    expect(delivered).toBe(0);
    expect(composeAdaptiveCoachMessage).not.toHaveBeenCalled();
    expect(
      coachProfileRepository.markAdaptiveSlotObserved
    ).toHaveBeenCalledWith('user-1', expect.stringMatching(/^2026-08-23T17:/));
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

  it('passes a safe concrete meal into an adaptive nutrition message', async () => {
    vi.mocked(
      coachProfileRepository.listProactiveCoachCandidates
    ).mockResolvedValue([
      {
        ...candidate,
        adaptiveCheckInsEnabled: true,
        dailyCheckInEnabled: false,
        weeklyReviewEnabled: false,
        proactiveCategories: ['nutrition'],
      },
    ]);
    vi.mocked(coachContextService.getCoachContextSnapshot).mockResolvedValue({
      ...snapshot,
      today: {
        ...snapshot.today,
        caloriesConsumed: 0,
        netCalories: 0,
        caloriesRemaining: 3000,
        proteinConsumedG: 0,
        proteinRemainingG: 160,
      },
    });
    vi.mocked(getCoachMealSuggestion).mockResolvedValue(mealSuggestion);

    await proactiveCoachService.processDueProactiveCoachMessages(
      new Date('2026-08-23T15:45:00.000Z')
    );

    expect(getCoachMealSuggestion).toHaveBeenCalledWith(
      'user-1',
      expect.any(Object),
      expect.stringMatching(/^2026-08-23T17:/)
    );
    expect(composeAdaptiveCoachMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunity: expect.objectContaining({ topic: 'nutrition' }),
        mealSuggestion,
      })
    );
  });

  it('sends a standalone evening restock reminder after a morning daily check-in', async () => {
    vi.mocked(
      coachProfileRepository.listProactiveCoachCandidates
    ).mockResolvedValue([
      {
        ...candidate,
        adaptiveCheckInsEnabled: false,
        dailyCheckInEnabled: true,
        dailyCheckInTime: '08:00',
        dailyLastSentOn: '2026-08-23',
        weeklyReviewEnabled: false,
        proactiveCategories: ['nutrition'],
      },
    ]);
    vi.mocked(getRestockReminder).mockResolvedValue({
      itemCount: 2,
      listId: '11111111-1111-4111-8111-111111111111',
      signature: 'reis-brokkoli',
      textDe: 'Reis und Brokkoli fehlen noch.',
      textEn: 'Rice and broccoli are still missing.',
    });

    const delivered =
      await proactiveCoachService.processDueProactiveCoachMessages(
        new Date('2026-08-23T15:45:00.000Z')
      );

    expect(delivered).toBe(1);
    expect(
      coachProfileRepository.saveProactiveMessageIfDue
    ).toHaveBeenCalledWith(
      'user-1',
      'restock',
      '2026-08-23',
      'Reis und Brokkoli fehlen noch.',
      'reis-brokkoli',
      { topic: 'nutrition', score: 96, tone: 'push' }
    );
    expect(coachContextService.getCoachContextSnapshot).not.toHaveBeenCalled();
    expect(composeAdaptiveCoachMessage).not.toHaveBeenCalled();
    expect(getCoachMealSuggestion).not.toHaveBeenCalled();
  });

  it('does not duplicate one restock reminder through adaptive and daily paths', async () => {
    vi.mocked(
      coachProfileRepository.listProactiveCoachCandidates
    ).mockResolvedValue([
      {
        ...candidate,
        adaptiveCheckInsEnabled: true,
        dailyCheckInEnabled: true,
        dailyCheckInTime: '17:00',
        weeklyReviewEnabled: false,
        proactiveCategories: ['nutrition'],
      },
    ]);
    vi.mocked(getRestockReminder).mockResolvedValue({
      itemCount: 2,
      listId: '11111111-1111-4111-8111-111111111111',
      signature: 'reis-brokkoli',
      textDe: 'Reis und Brokkoli fehlen noch.',
      textEn: 'Rice and broccoli are still missing.',
    });

    const delivered =
      await proactiveCoachService.processDueProactiveCoachMessages(
        new Date('2026-08-23T15:45:00.000Z')
      );

    expect(delivered).toBe(2);
    expect(composeAdaptiveCoachMessage).not.toHaveBeenCalled();
    const savedContents = vi
      .mocked(coachProfileRepository.saveProactiveMessageIfDue)
      .mock.calls.map((call) => call[3]);
    expect(
      savedContents.filter((content) =>
        content.includes('Reis und Brokkoli fehlen noch.')
      )
    ).toEqual(['Reis und Brokkoli fehlen noch.']);
    expect(
      coachProfileRepository.markAdaptiveSlotObserved
    ).toHaveBeenCalledOnce();
  });

  it('renders meal prep and shopping details in scheduled coach messages', () => {
    const daily = proactiveCoachService.renderDailyCoachMessage(
      snapshot,
      'de',
      mealSuggestion
    );
    const weekly = proactiveCoachService.renderWeeklyCoachMessage(
      snapshot,
      'de',
      mealSuggestion
    );

    expect(daily).toContain('Hähnchen-Reis-Gemüse-Bowl');
    expect(daily).toContain('Einkauf für 2 Portionen');
    expect(weekly).toContain('Konkreter Meal-Prep-Start');
    expect(weekly).toContain('Zubereitung:');
    expect(weekly).toContain('Plane **Hähnchen-Reis-Gemüse-Bowl**');
    expect(weekly).not.toContain('Iss als Nächstes');
  });

  it('does not turn a protein gap into another full meal after calories are exhausted', () => {
    const overTarget = {
      ...snapshot,
      today: {
        ...snapshot.today,
        caloriesConsumed: 3100,
        netCalories: 3100,
        caloriesRemaining: -100,
        proteinConsumedG: 130,
        proteinRemainingG: 30,
      },
    };

    const message = proactiveCoachService.renderDailyCoachMessage(
      overTarget,
      'de'
    );

    expect(message).toContain('Kalorienziel ist heute bereits überschritten');
    expect(message).not.toContain('proteinreiche Mahlzeit');
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

  it('uses local evening time and the restock delivery marker independently', () => {
    const morningDailyAlreadySent = {
      ...candidate,
      adaptiveCheckInsEnabled: false,
      dailyCheckInTime: '08:00',
      dailyLastSentOn: '2026-08-23',
      weeklyReviewEnabled: false,
    };

    expect(
      proactiveCoachService.isEveningRestockCheckDue(
        morningDailyAlreadySent,
        new Date('2026-08-23T14:59:00.000Z')
      )
    ).toBe(false);
    expect(
      proactiveCoachService.isEveningRestockCheckDue(
        morningDailyAlreadySent,
        new Date('2026-08-23T15:00:00.000Z')
      )
    ).toBe(true);
    expect(
      proactiveCoachService.isEveningRestockCheckDue(
        { ...morningDailyAlreadySent, restockLastSentOn: '2026-08-23' },
        new Date('2026-08-23T15:00:00.000Z')
      )
    ).toBe(false);
    expect(
      proactiveCoachService.isEveningRestockCheckDue(
        {
          ...morningDailyAlreadySent,
          dailyCheckInEnabled: false,
          adaptiveCheckInsEnabled: false,
        },
        new Date('2026-08-23T15:00:00.000Z')
      )
    ).toBe(false);
    expect(
      proactiveCoachService.isEveningRestockCheckDue(
        { ...morningDailyAlreadySent, proactiveCategories: ['training'] },
        new Date('2026-08-23T15:00:00.000Z')
      )
    ).toBe(false);
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
    expect(getCoachMealSuggestion).toHaveBeenCalledTimes(1);
    expect(getCoachMealSuggestion).toHaveBeenCalledWith(
      'user-1',
      { caloriesRemaining: 3000, proteinRemainingG: 160 },
      '2026-08-23:weekly'
    );
  });

  it('does not add meal planning when nutrition coaching is disabled', async () => {
    vi.mocked(
      coachProfileRepository.listProactiveCoachCandidates
    ).mockResolvedValue([
      {
        ...candidate,
        proactiveCategories: ['hydration', 'training', 'recovery'],
      },
    ]);

    await proactiveCoachService.processDueProactiveCoachMessages(
      new Date('2026-08-23T18:15:00.000Z')
    );

    expect(getCoachMealSuggestion).not.toHaveBeenCalled();
    expect(
      coachProfileRepository.saveProactiveMessageIfDue
    ).toHaveBeenCalledWith(
      'user-1',
      'weekly',
      '2026-08-23',
      expect.not.stringContaining('vollständige Zutatenliste'),
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
