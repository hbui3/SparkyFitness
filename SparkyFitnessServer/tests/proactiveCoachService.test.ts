import { beforeEach, describe, expect, it, vi } from 'vitest';
import proactiveCoachService from '../services/proactiveCoachService.js';
import coachProfileRepository from '../models/coachProfileRepository.js';
import coachContextService from '../services/coachContextService.js';

vi.mock('../models/coachProfileRepository.js', () => ({
  default: {
    listProactiveCoachCandidates: vi.fn(),
    saveProactiveMessageIfDue: vi.fn(),
  },
}));
vi.mock('../services/coachContextService.js', () => ({
  default: {
    getCoachContextSnapshot: vi.fn(),
  },
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

const candidate = {
  userId: 'user-1',
  timezone: 'Europe/Berlin',
  language: 'de',
  dailyCheckInEnabled: true,
  dailyCheckInTime: '20:00',
  dailyLastSentOn: null,
  weeklyReviewEnabled: true,
  weeklyReviewDay: 0,
  weeklyReviewTime: '18:00',
  weeklyLastSentOn: null,
};

const snapshot = {
  timezone: 'Europe/Berlin',
  today: {
    date: '2026-08-23',
    primaryGoal: 'gain_weight',
    calorieTarget: 3000,
    proteinTargetG: 160,
    waterTargetMl: 3000,
    caloriesConsumed: 1800,
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
      coachProfileRepository.saveProactiveMessageIfDue
    ).mockResolvedValue(true);
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
      expect.stringContaining('täglicher Coach-Check-in')
    );
    expect(
      coachProfileRepository.saveProactiveMessageIfDue
    ).toHaveBeenCalledWith(
      'user-1',
      'weekly',
      '2026-08-23',
      expect.stringContaining('Wochenrückblick')
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
