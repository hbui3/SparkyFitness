import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  logWorkoutPresetGrouped: vi.fn(),
  listSpeedianceWorkouts: vi.fn(),
  setSpeedianceWorkoutSchedule: vi.fn(),
  getCanonicalWorkoutEntries: vi.fn(),
}));

vi.mock('../db/poolManager.js', () => ({
  getClient: vi.fn(async () => ({
    query: mocks.query,
    release: mocks.release,
  })),
}));

vi.mock('../services/exerciseService.js', () => ({
  default: { logWorkoutPresetGrouped: mocks.logWorkoutPresetGrouped },
}));

vi.mock('../integrations/speediance/speedianceWorkoutService.js', () => ({
  default: {
    listSpeedianceWorkouts: mocks.listSpeedianceWorkouts,
    setSpeedianceWorkoutSchedule: mocks.setSpeedianceWorkoutSchedule,
  },
}));

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

vi.mock('../services/workoutDeduplicationService.js', () => ({
  default: { getCanonicalWorkoutEntries: mocks.getCanonicalWorkoutEntries },
}));

import plannedWorkoutScheduleService from '../services/plannedWorkoutScheduleService.js';

describe('plannedWorkoutScheduleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({
      rows: [
        {
          name: 'Sparky Full Body A',
          entry_date: '2026-08-20',
          workout_preset_id: 44,
          workout_plan_assignment_id: 9,
          source: 'Workout Plan',
          completed: false,
        },
      ],
    });
    mocks.listSpeedianceWorkouts.mockResolvedValue({
      workouts: [
        {
          id: '501',
          code: 'sparky-code',
          name: 'Sparky Full Body A',
          exerciseCount: 7,
          nativeWorkoutPresetId: 44,
        },
      ],
    });
    mocks.setSpeedianceWorkoutSchedule.mockResolvedValue({
      success: true,
      code: 'sparky-code',
      date: '2026-08-21',
      status: 'scheduled',
    });
    mocks.getCanonicalWorkoutEntries.mockResolvedValue({
      allEntries: [],
      workoutEntries: [],
      duplicateSummary: { hiddenCount: 0, hiddenBySource: {} },
    });
  });

  it('carries a missed planned session into Sparky and Speediance exactly once', async () => {
    const carried =
      await plannedWorkoutScheduleService.carryForwardMissedWorkouts(
        'user-1',
        '2026-08-21'
      );

    expect(carried).toEqual([
      expect.objectContaining({
        name: 'Sparky Full Body A',
        date: '2026-08-21',
        workoutPresetId: 44,
      }),
    ]);
    expect(mocks.logWorkoutPresetGrouped).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      44,
      '2026-08-21',
      expect.objectContaining({
        source: 'Workout Plan',
        workoutPlanAssignmentId: 9,
      })
    );
    expect(mocks.setSpeedianceWorkoutSchedule).toHaveBeenCalledWith(
      'user-1',
      'sparky-code',
      '2026-08-21',
      true
    );
  });

  it('returns exact warm-up counts and the complete canonical chronology', async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'planned-1',
            name: 'Full Body A',
            entry_date: '2026-08-24',
            workout_preset_id: 44,
            workout_plan_assignment_id: 9,
            source: 'Workout Plan',
            completed: false,
            exercise_count: '7',
            total_set_count: '18',
            warmup_set_count: '0',
          },
          {
            id: 'speediance-1',
            name: 'Full Body A',
            entry_date: '2026-08-20',
            workout_preset_id: 44,
            workout_plan_assignment_id: null,
            source: 'Speediance',
            completed: false,
            exercise_count: '7',
            total_set_count: '18',
            warmup_set_count: '0',
          },
          {
            id: 'replaced-plan-1',
            name: 'Full Body A planned',
            entry_date: '2026-08-20',
            workout_preset_id: 44,
            workout_plan_assignment_id: 9,
            source: 'Workout Plan',
            completed: false,
            exercise_count: '7',
            total_set_count: '18',
            warmup_set_count: '0',
          },
          {
            id: 'healthkit-mirror-1',
            name: 'Traditional Strength Training',
            entry_date: '2026-08-20',
            workout_preset_id: null,
            workout_plan_assignment_id: null,
            source: 'Apple Health',
            completed: true,
            exercise_count: '1',
            total_set_count: '0',
            warmup_set_count: '0',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            plan_id: 1,
            plan_name: 'Sparky Muskelaufbau',
            description: 'Drei Tage',
            start_date: '2026-08-24',
            end_date: '2026-10-18',
            day_of_week: 1,
            workout_preset_id: 44,
            workout_name: 'Full Body A',
            exercise_count: '7',
            total_set_count: '18',
            warmup_set_count: '0',
          },
        ],
      });
    mocks.getCanonicalWorkoutEntries.mockResolvedValue({
      allEntries: [],
      workoutEntries: [
        {
          id: 'exercise-1',
          exercise_preset_entry_id: 'speediance-1',
        },
      ],
      duplicateSummary: { hiddenCount: 0, hiddenBySource: {} },
    });

    const timeline = await plannedWorkoutScheduleService.getTrainingTimeline(
      'user-1',
      '2026-08-21'
    );

    expect(timeline.activePlans[0]?.assignments[0]).toEqual(
      expect.objectContaining({
        exerciseCount: 7,
        totalSetCount: 18,
        warmupSetCount: 0,
        workingSetCount: 18,
      })
    );
    expect(timeline.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'speediance-1',
          status: 'completed',
          source: 'Speediance',
        }),
        expect.objectContaining({
          id: 'planned-1',
          status: 'planned',
          warmupSetCount: 0,
        }),
      ])
    );
    expect(
      timeline.items.filter((item) => item.date === '2026-08-20')
    ).toHaveLength(1);
    expect(timeline.days).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: '2026-08-20',
          status: 'completed',
          scheduledWorkoutCount: 1,
          completedScheduledWorkoutCount: 1,
          scheduledSetCount: 18,
          completedScheduledSetCount: 18,
          sources: ['Workout Plan', 'Speediance'],
        }),
        expect.objectContaining({
          date: '2026-08-24',
          status: 'planned',
          scheduledWorkoutCount: 1,
          completedScheduledWorkoutCount: 0,
        }),
      ])
    );
  });
});
