import type { ExerciseSessionResponse } from '@workspace/shared';
import type {
  WorkoutPlanAssignment,
  WorkoutPlanTemplate,
} from '../../src/types/workoutPlans';
import {
  findDueAssignmentForPreset,
  getLoggedAssignmentIds,
  scheduledWorkoutsForWatch,
} from '../../src/utils/workoutPlanSchedule';

const labels = {
  scheduledToday: 'Scheduled Today',
  sessionOf: (current: number, total: number) =>
    `Session ${current} of ${total}`,
};

function assignment(
  id: string,
  overrides: Partial<WorkoutPlanAssignment> = {}
): WorkoutPlanAssignment {
  return {
    id,
    template_id: 'plan-1',
    day_of_week: 1,
    sort_order: 0,
    workout_preset_id: `preset-${id}`,
    workout_preset_name: `Workout ${id}`,
    sets: [],
    ...overrides,
  };
}

function plan(
  overrides: Partial<WorkoutPlanTemplate> = {}
): WorkoutPlanTemplate {
  return {
    id: 'plan-1',
    user_id: 'user-1',
    plan_name: 'main',
    start_date: '2026-10-01',
    is_active: true,
    schedule_type: 'weekly',
    ...overrides,
  };
}

describe('scheduledWorkoutsForWatch', () => {
  it('lists the workout a weekly plan has due today', () => {
    const due = assignment('1', { workout_preset_name: 'Day 2 Upper (5 Day)' });
    expect(
      scheduledWorkoutsForWatch(
        [plan({ assignments: [due], next_assignment: due })],
        [],
        labels
      )
    ).toEqual([
      {
        presetId: 'preset-1',
        name: 'Day 2 Upper (5 Day)',
        planName: 'main',
        caption: 'Scheduled Today',
      },
    ]);
  });

  it('lists every workout a weekly plan has due today', () => {
    const a = assignment('1');
    const b = assignment('2');
    const rows = scheduledWorkoutsForWatch(
      [
        plan({
          assignments: [a, b],
          next_assignment: a,
          next_assignments: [a, b],
        }),
      ],
      [],
      labels
    );
    expect(rows.map((row) => row.presetId)).toEqual(['preset-1', 'preset-2']);
  });

  it('names the session a sequential plan is on', () => {
    const next = assignment('3', { session_name: null, session_index: 2 });
    const rows = scheduledWorkoutsForWatch(
      [
        plan({
          schedule_type: 'sequential',
          assignments: [assignment('2'), next],
          next_assignment: next,
          sequence_position: { current: 2, total: 5 },
        }),
      ],
      [],
      labels
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].caption).toBe('Session 2 of 5');
  });

  it('prefers the session name a sequential plan gives', () => {
    const next = assignment('3');
    const rows = scheduledWorkoutsForWatch(
      [
        plan({
          schedule_type: 'sequential',
          assignments: [next],
          next_assignment: next,
          sequence_position: { current: 1, total: 3, session_name: 'Pull day' },
        }),
      ],
      [],
      labels
    );
    expect(rows[0].caption).toBe('Pull day');
  });

  it('skips a plan already logged today', () => {
    const due = assignment('1');
    const logged = [
      { id: 9, workout_plan_assignment_id: '1' },
    ] as unknown as ExerciseSessionResponse[];
    expect(
      scheduledWorkoutsForWatch(
        [plan({ assignments: [due], next_assignment: due })],
        logged,
        labels
      )
    ).toEqual([]);
  });

  it('skips an assignment with no saved workout behind it', () => {
    const single = assignment('1', {
      workout_preset_id: null,
      workout_preset_name: null,
      exercise_id: 'ex-1',
      exercise_name: 'Squat',
    });
    expect(
      scheduledWorkoutsForWatch(
        [plan({ assignments: [single], next_assignment: single })],
        [],
        labels
      )
    ).toEqual([]);
  });
});

describe('getLoggedAssignmentIds', () => {
  it('reads the assignment from a session and from its exercises', () => {
    const ids = getLoggedAssignmentIds([
      { id: 1, workout_plan_assignment_id: 'a' },
      { id: 2, exercises: [{ workout_plan_assignment_id: 'b' }] },
    ] as unknown as ExerciseSessionResponse[]);
    expect([...ids].sort()).toEqual(['a', 'b']);
  });
});

describe('findDueAssignmentForPreset', () => {
  it('finds the due assignment for a preset id, weekly or sequential', () => {
    const due = assignment('7', { workout_preset_id: '42' });
    const other = assignment('8', { workout_preset_id: '43' });
    const weekly = plan({
      assignments: [due, other],
      next_assignment: other,
      next_assignments: [due, other],
    });
    expect(findDueAssignmentForPreset([weekly], 42)?.id).toBe('7');
    const sequential = plan({
      schedule_type: 'sequential',
      assignments: [due, other],
      next_assignment: other,
    });
    expect(findDueAssignmentForPreset([sequential], 43)?.id).toBe('8');
    expect(findDueAssignmentForPreset([sequential], 42)).toBeNull();
  });
});
