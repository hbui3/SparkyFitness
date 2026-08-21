import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  logWorkoutPresetGrouped: vi.fn(),
  listSpeedianceWorkouts: vi.fn(),
  setSpeedianceWorkoutSchedule: vi.fn(),
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
});
