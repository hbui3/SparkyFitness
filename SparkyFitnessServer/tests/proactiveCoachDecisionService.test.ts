import { describe, expect, it } from 'vitest';
import type { CoachContextSnapshot } from '../services/coachContextService.js';
import { evaluateProactiveCoachOpportunity } from '../services/proactiveCoachDecisionService.js';

function snapshot(
  overrides: Partial<CoachContextSnapshot> = {}
): CoachContextSnapshot {
  const base: CoachContextSnapshot = {
    timezone: 'Europe/Berlin',
    today: {
      date: '2026-08-24',
      primaryGoal: 'gain_weight',
      calorieTarget: 3000,
      proteinTargetG: 160,
      waterTargetMl: 3000,
      caloriesConsumed: 1900,
      caloriesBurned: 400,
      netCalories: 1500,
      caloriesRemaining: 1100,
      proteinConsumedG: 120,
      proteinRemainingG: 40,
      waterConsumedMl: 2000,
      waterRemainingMl: 1000,
    },
    week: {
      startDate: '2026-08-18',
      endDate: '2026-08-24',
      totalDays: 7,
      nutritionLoggedDays: 4,
      averageCaloriesOnLoggedDays: 2800,
      averageProteinOnLoggedDaysG: 145,
      averageCalorieTarget: 3000,
      averageProteinTargetG: 160,
      calorieTargetDays: 3,
      waterLoggedDays: 4,
      averageWaterOnLoggedDaysMl: 2500,
      averageWaterTargetMl: 3000,
      workoutCount: 2,
    },
    longTerm: {
      startDate: '2026-07-26',
      endDate: '2026-08-24',
      totalDays: 30,
      nutritionLoggedDays: 20,
      averageCaloriesOnLoggedDays: 2700,
      averageProteinOnLoggedDaysG: 140,
      averageCalorieTarget: 3000,
      averageProteinTargetG: 160,
      calorieTargetDays: 12,
      waterLoggedDays: 20,
      averageWaterOnLoggedDaysMl: 2500,
      averageWaterTargetMl: 3000,
      workoutCount: 10,
    },
    weight30Days: {
      entries: 2,
      firstWeightKg: 80,
      latestWeightKg: 80,
      changeKg: 0,
    },
    recovery: {
      observedOn: '2026-08-24',
      sleepHours: 7.5,
      sleepScore: 80,
      restingHeartRate: 55,
      hrvRmssdMs: 60,
      vo2Max: 48,
      recoveryTimeHours: 6,
      trainingReadinessScore: 80,
      acuteTrainingLoad: 500,
      chronicTrainingLoad: 480,
      acwrRatio: 1.04,
      stressLevel: 25,
      bodyBatteryHighest: 90,
      bodyBatteryLowest: 30,
      recentMuscleLoad: [],
    },
    adaptiveTraining: {
      id: '00000000-0000-4000-8000-000000000001',
      date: '2026-08-24',
      kind: 'workout',
      presetId: 1,
      presetName: 'Full Body',
      score: 86,
      status: 'planned',
      volumeFactor: 1,
      rationale: [],
      algorithmVersion: 'adaptive-v1',
      generatedAt: '2026-08-24T06:00:00.000Z',
    },
  };
  return { ...base, ...overrides };
}

const now = new Date('2026-08-24T15:30:00.000Z');

describe('proactiveCoachDecisionService', () => {
  it('prioritizes a serious recovery signal over a routine training push', () => {
    const current = snapshot({
      recovery: {
        ...snapshot().recovery,
        sleepScore: 42,
        trainingReadinessScore: 35,
      },
    });

    const decision = evaluateProactiveCoachOpportunity({
      snapshot: current,
      categories: ['training', 'recovery'],
      timezone: current.timezone,
      now,
      minimumMessageIntervalMinutes: 60,
      lastAdaptiveMessageAt: null,
      lastUserMessageAt: null,
      recentMessages: [],
    });

    expect(decision.shouldSend).toBe(true);
    expect(decision.opportunity).toMatchObject({
      topic: 'recovery',
      tone: 'protect',
      score: 90,
    });
  });

  it('names a carried-forward scheduled workout and treats it as the top action', () => {
    const current = snapshot({
      trainingSchedule: {
        dueToday: [
          {
            name: 'Sparky Full Body A',
            date: '2026-08-24',
            workoutPresetId: 44,
            workoutPlanAssignmentId: 9,
            completed: false,
          },
        ],
        completedToday: [],
        missedYesterday: [
          {
            name: 'Sparky Full Body A',
            date: '2026-08-23',
            workoutPresetId: 44,
            workoutPlanAssignmentId: 9,
            completed: false,
          },
        ],
        carriedForwardToday: [],
      },
    });

    const decision = evaluateProactiveCoachOpportunity({
      snapshot: current,
      categories: ['training'],
      timezone: current.timezone,
      now,
      minimumMessageIntervalMinutes: 60,
      lastAdaptiveMessageAt: null,
      lastUserMessageAt: null,
      recentMessages: [],
    });

    expect(decision.opportunity).toMatchObject({
      topic: 'training',
      tone: 'push',
      score: 94,
    });
    expect(decision.opportunity?.summaryDe).toContain('Sparky Full Body A');
    expect(decision.opportunity?.summaryDe).toContain(
      'gestern nicht absolviert'
    );
  });

  it('stays quiet until the configured minimum message interval has passed', () => {
    const decision = evaluateProactiveCoachOpportunity({
      snapshot: snapshot(),
      categories: ['training'],
      timezone: 'Europe/Berlin',
      now,
      minimumMessageIntervalMinutes: 120,
      lastAdaptiveMessageAt: '2026-08-24T14:30:00.000Z',
      lastUserMessageAt: null,
      recentMessages: [],
    });

    expect(decision).toEqual({
      shouldSend: false,
      reason: 'global_cooldown',
      opportunity: null,
    });
  });

  it('does not interrupt an active conversation', () => {
    const decision = evaluateProactiveCoachOpportunity({
      snapshot: snapshot(),
      categories: ['training'],
      timezone: 'Europe/Berlin',
      now,
      minimumMessageIntervalMinutes: 30,
      lastAdaptiveMessageAt: null,
      lastUserMessageAt: '2026-08-24T15:20:00.000Z',
      recentMessages: [],
    });

    expect(decision.reason).toBe('active_conversation');
    expect(decision.shouldSend).toBe(false);
  });

  it('switches to another useful topic instead of repeating a recent one', () => {
    const current = snapshot({
      today: {
        ...snapshot().today,
        caloriesConsumed: 0,
        netCalories: 0,
        caloriesRemaining: 3000,
        proteinConsumedG: 0,
        proteinRemainingG: 160,
      },
    });
    const decision = evaluateProactiveCoachOpportunity({
      snapshot: current,
      categories: ['training', 'nutrition'],
      timezone: current.timezone,
      now,
      minimumMessageIntervalMinutes: 30,
      lastAdaptiveMessageAt: '2026-08-24T13:00:00.000Z',
      lastUserMessageAt: null,
      recentMessages: [
        {
          content: 'Lege jetzt deine Startzeit fürs Training fest.',
          topic: 'training',
          stateSignature: 'older-state',
          createdAt: '2026-08-24T13:00:00.000Z',
        },
      ],
    });

    expect(decision.shouldSend).toBe(true);
    expect(decision.opportunity?.topic).toBe('nutrition');
  });

  it('can decide the first meal early enough to support shopping and prep', () => {
    const current = snapshot({
      today: {
        ...snapshot().today,
        caloriesConsumed: 0,
        netCalories: 0,
        caloriesRemaining: 3000,
        proteinConsumedG: 0,
        proteinRemainingG: 160,
      },
    });

    const decision = evaluateProactiveCoachOpportunity({
      snapshot: current,
      categories: ['nutrition'],
      timezone: current.timezone,
      now: new Date('2026-08-24T07:30:00.000Z'),
      minimumMessageIntervalMinutes: 60,
      lastAdaptiveMessageAt: null,
      lastUserMessageAt: null,
      recentMessages: [],
    });

    expect(decision.shouldSend).toBe(true);
    expect(decision.opportunity).toMatchObject({
      topic: 'nutrition',
      score: 72,
      actionDe: expect.stringContaining('genauen Mengen'),
    });
  });

  it('does not push a full meal for protein after the calorie budget is exhausted', () => {
    const current = snapshot({
      today: {
        ...snapshot().today,
        caloriesConsumed: 3100,
        netCalories: 3100,
        caloriesRemaining: -100,
        proteinConsumedG: 130,
        proteinRemainingG: 30,
      },
    });

    const decision = evaluateProactiveCoachOpportunity({
      snapshot: current,
      categories: ['nutrition'],
      timezone: current.timezone,
      now,
      minimumMessageIntervalMinutes: 60,
      lastAdaptiveMessageAt: null,
      lastUserMessageAt: null,
      recentMessages: [],
    });

    expect(decision).toEqual({
      shouldSend: false,
      reason: 'no_relevant_opportunity',
      opportunity: null,
    });
  });
});
