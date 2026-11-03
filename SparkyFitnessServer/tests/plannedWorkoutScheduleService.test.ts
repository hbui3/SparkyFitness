import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trainingTimelineResponseSchema } from '@workspace/shared';

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

const planAssignment = {
  plan_id: 1,
  plan_name: 'Full Body Cycle',
  description: null,
  start_date: '2026-08-24',
  end_date: '2026-09-07',
  cycle_length_weeks: 1,
  schedule_type: 'weekly',
  assignment_id: 9,
  day_of_week: 1,
  week_index: 0,
  session_index: null,
  session_name: null,
  workout_preset_id: 44,
  workout_name: 'Full Body A',
  exercise_count: '7',
  total_set_count: '18',
  warmup_set_count: '2',
};
const providerWorkout = {
  id: 'provider-session',
  name: 'Full Body A',
  entry_date: '2026-08-24',
  workout_preset_id: 44,
  workout_plan_assignment_id: null,
  source: 'Speediance',
  completed: false,
  exercise_count: '7',
  total_set_count: '18',
  warmup_set_count: '2',
  completed_exercise_count: '0',
  completed_set_count: '0',
  completed_warmup_set_count: '0',
};

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

  it('does not plan yesterday’s workout again after it was completed today', async () => {
    const missed = {
      name: 'Sparky Full Body A',
      entry_date: '2026-08-20',
      workout_preset_id: 44,
      workout_plan_assignment_id: 9,
      source: 'Workout Plan',
      completed: false,
    };
    for (const source of ['Workout Plan', 'Speediance', 'manual']) {
      mocks.query.mockResolvedValue({
        rows: [
          missed,
          { ...missed, entry_date: '2026-08-21', source, completed: true },
        ],
      });
      await expect(
        plannedWorkoutScheduleService.carryForwardMissedWorkouts(
          'user-1',
          '2026-08-21'
        )
      ).resolves.toEqual([]);
    }
    expect(mocks.logWorkoutPresetGrouped).not.toHaveBeenCalled();
    expect(mocks.setSpeedianceWorkoutSchedule).not.toHaveBeenCalled();
  });

  it('carries only one copy when yesterday contains duplicate plan rows', async () => {
    const missed = {
      name: 'Sparky Full Body A',
      entry_date: '2026-08-20',
      workout_preset_id: 44,
      workout_plan_assignment_id: 9,
      source: 'Workout Plan',
      completed: false,
    };
    mocks.query.mockResolvedValue({ rows: [missed, missed] });
    const carried =
      await plannedWorkoutScheduleService.carryForwardMissedWorkouts(
        'user-1',
        '2026-08-21'
      );
    expect(carried).toHaveLength(1);
    expect(mocks.logWorkoutPresetGrouped).toHaveBeenCalledTimes(1);
    expect(mocks.setSpeedianceWorkoutSchedule).toHaveBeenCalledTimes(1);
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
  it('projects prompt-mode weekly plans through their real cycle without writing diary rows', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [{ ...planAssignment, cycle_length_weeks: 2 }],
    });
    const result =
      await plannedWorkoutScheduleService.getTrainingTimelineForRange(
        'user-1',
        '2026-08-21',
        '2026-08-24',
        '2026-09-07'
      );
    expect(result.items.map((item) => item.date)).toEqual([
      '2026-08-24',
      '2026-09-07',
    ]);
    expect(result.days).toHaveLength(2);
    expect(result.days[0]).toMatchObject({
      scheduledWorkoutCount: 1,
      scheduledSetCount: 18,
      status: 'planned',
    });
    expect(
      mocks.query.mock.calls.some(([sql]) =>
        /^(INSERT|UPDATE|DELETE)\b/i.test(String(sql).trim())
      )
    ).toBe(false);
  });

  it('includes a materialized individual-exercise plan in the calendar totals', async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            ...providerWorkout,
            id: 'single-plan-entry',
            name: 'Squat',
            source: 'Workout Plan',
            workout_preset_id: null,
            workout_plan_assignment_id: 17,
            exercise_count: 1,
            total_set_count: 3,
            warmup_set_count: 1,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const result =
      await plannedWorkoutScheduleService.getTrainingTimelineForRange(
        'user-1',
        '2026-08-21',
        '2026-08-24',
        '2026-08-24'
      );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'single-plan-entry',
      status: 'planned',
    });
    expect(result.days[0]).toMatchObject({
      scheduledWorkoutCount: 1,
      scheduledExerciseCount: 1,
      scheduledSetCount: 3,
    });
    expect(String(mocks.query.mock.calls[0]?.[0])).toContain(
      'ee.exercise_preset_entry_id IS NULL'
    );
  });

  it('retains scheduled targets after an imported workout replaces its diary placeholder', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [providerWorkout] })
      .mockResolvedValueOnce({ rows: [planAssignment] });
    mocks.getCanonicalWorkoutEntries.mockResolvedValue({
      workoutEntries: [
        { id: 'provider-child', exercise_preset_entry_id: providerWorkout.id },
      ],
    });
    const result =
      await plannedWorkoutScheduleService.getTrainingTimelineForRange(
        'user-1',
        '2026-08-24',
        '2026-08-24',
        '2026-08-24'
      );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.status).toBe('completed');
    expect(result.days[0]).toMatchObject({
      scheduledWorkoutCount: 1,
      completedScheduledWorkoutCount: 1,
      scheduledSetCount: 18,
      completedScheduledSetCount: 18,
      status: 'completed',
    });
  });

  it('one completed workout does not satisfy two separate slots of the same preset', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [providerWorkout] })
      .mockResolvedValueOnce({
        rows: [planAssignment, { ...planAssignment, assignment_id: 10 }],
      });
    mocks.getCanonicalWorkoutEntries.mockResolvedValue({
      workoutEntries: [
        { id: 'provider-child', exercise_preset_entry_id: providerWorkout.id },
      ],
    });
    const result =
      await plannedWorkoutScheduleService.getTrainingTimelineForRange(
        'user-1',
        '2026-08-24',
        '2026-08-24',
        '2026-08-24'
      );
    expect(result.items.map((item) => item.status).sort()).toEqual([
      'completed',
      'planned',
    ]);
    expect(result.days[0]).toMatchObject({
      scheduledWorkoutCount: 2,
      completedScheduledWorkoutCount: 1,
      scheduledSetCount: 36,
      completedScheduledSetCount: 18,
      status: 'in_progress',
    });
  });

  it('counts a completed standalone plan exercise once while matching its assignment', async () => {
    const individual = {
      ...providerWorkout,
      id: 'individual',
      name: 'Squat',
      source: 'Manual',
      workout_preset_id: null,
      workout_plan_assignment_id: 17,
      exercise_count: 1,
      total_set_count: 3,
      warmup_set_count: 1,
    };
    mocks.query
      .mockResolvedValueOnce({ rows: [individual] })
      .mockResolvedValueOnce({
        rows: [
          {
            ...planAssignment,
            assignment_id: 17,
            workout_preset_id: null,
            workout_name: 'Squat',
            exercise_count: 1,
            total_set_count: 3,
            warmup_set_count: 1,
          },
        ],
      });
    mocks.getCanonicalWorkoutEntries.mockResolvedValue({
      workoutEntries: [
        {
          id: 'individual',
          exercise_preset_entry_id: null,
          entry_date: '2026-08-24',
          exercise_name: 'Squat',
          exercise_source: 'Manual',
          sets: [],
          workout_plan_assignment_id: 17,
        },
      ],
    });
    const result =
      await plannedWorkoutScheduleService.getTrainingTimelineForRange(
        'user-1',
        '2026-08-24',
        '2026-08-24',
        '2026-08-24'
      );
    expect(result.items).toHaveLength(1);
    expect(result.days[0]).toMatchObject({
      scheduledWorkoutCount: 1,
      completedScheduledWorkoutCount: 1,
      completedWorkoutCount: 1,
      status: 'completed',
    });
  });

  it('represents sequential plans as sessions without inventing calendar dates', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        {
          ...planAssignment,
          schedule_type: 'sequential',
          day_of_week: null,
          session_index: 2,
          session_name: 'Upper body',
        },
      ],
    });
    const result =
      await plannedWorkoutScheduleService.getTrainingTimelineForRange(
        'user-1',
        '2026-08-21',
        '2026-08-24',
        '2026-09-07'
      );
    expect(result.items).toEqual([]);
    expect(result.activePlans[0]).toMatchObject({
      scheduleType: 'sequential',
      assignments: [
        expect.objectContaining({
          dayOfWeek: null,
          sessionIndex: 2,
          sessionName: 'Upper body',
        }),
      ],
    });
    expect(() => trainingTimelineResponseSchema.parse(result)).not.toThrow();
  });
});
