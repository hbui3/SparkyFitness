import type { ExerciseSessionResponse } from '@workspace/shared';
import type {
  WorkoutPlanAssignment,
  WorkoutPlanTemplate,
} from '../types/workoutPlans';

/** Plan assignments the day's diary already holds a logged session for. */
export function getLoggedAssignmentIds(
  exerciseEntries: readonly ExerciseSessionResponse[]
): Set<string> {
  const ids = new Set<string>();
  for (const session of exerciseEntries) {
    if (
      'workout_plan_assignment_id' in session &&
      session.workout_plan_assignment_id != null
    ) {
      ids.add(String(session.workout_plan_assignment_id));
    }
    if ('exercises' in session && Array.isArray(session.exercises)) {
      for (const ex of session.exercises) {
        if (
          ex &&
          'workout_plan_assignment_id' in ex &&
          ex.workout_plan_assignment_id != null
        ) {
          ids.add(String(ex.workout_plan_assignment_id));
        }
      }
    }
  }
  return ids;
}

/** Active plans with something still to do: a next assignment, and none of the
 * plan's assignments logged yet today. */
export function getUncompletedActivePlans(
  plans: readonly WorkoutPlanTemplate[],
  loggedAssignmentIds: ReadonlySet<string>
): WorkoutPlanTemplate[] {
  return plans.filter((plan) => {
    if (!plan.next_assignment) return false;
    const planAssignmentIds = (plan.assignments || []).map((a) => String(a.id));
    return !planAssignmentIds.some((id) => loggedAssignmentIds.has(id));
  });
}

/** What a plan has due now: the sequential plan's current session, or
 * everything a weekly plan lists for today. */
function dueAssignments(plan: WorkoutPlanTemplate): WorkoutPlanAssignment[] {
  if (plan.schedule_type === 'sequential') {
    return plan.next_assignment ? [plan.next_assignment] : [];
  }
  if (plan.next_assignments && plan.next_assignments.length > 0) {
    return plan.next_assignments;
  }
  return plan.next_assignment ? [plan.next_assignment] : [];
}

/** The assignment a saved workout is due as, so starting it from somewhere
 * other than the Diary (the watch) can still count toward the plan. */
export function findDueAssignmentForPreset(
  plans: readonly WorkoutPlanTemplate[],
  presetId: number
): WorkoutPlanAssignment | null {
  for (const plan of plans) {
    const match = dueAssignments(plan).find(
      (a) =>
        a.workout_preset_id != null && Number(a.workout_preset_id) === presetId
    );
    if (match) return match;
  }
  return null;
}

export interface WatchScheduledWorkout {
  presetId: string;
  /** The workout's own name, e.g. "Day 2 Upper (5 Day)". */
  name: string;
  planName: string;
  /** "Scheduled Today", or the session a sequential plan is on. */
  caption: string;
}

export interface ScheduledWorkoutLabels {
  scheduledToday: string;
  sessionOf: (current: number, total: number) => string;
}

/** Today's planned workouts the watch can start: one per assignment that has a
 * saved workout behind it (the watch only starts presets). A weekly plan lists
 * everything due today; a sequential plan lists the session it is on. */
export function scheduledWorkoutsForWatch(
  plans: readonly WorkoutPlanTemplate[],
  exerciseEntries: readonly ExerciseSessionResponse[],
  labels: ScheduledWorkoutLabels
): WatchScheduledWorkout[] {
  const result: WatchScheduledWorkout[] = [];
  const seen = new Set<string>();
  const open = getUncompletedActivePlans(
    plans,
    getLoggedAssignmentIds(exerciseEntries)
  );
  for (const plan of open) {
    const sequential = plan.schedule_type === 'sequential';
    const due = dueAssignments(plan);
    const caption = sequential
      ? plan.sequence_position?.session_name ||
        plan.next_assignment?.session_name ||
        labels.sessionOf(
          plan.sequence_position?.current ?? 1,
          plan.sequence_position?.total ?? plan.assignments?.length ?? 1
        )
      : labels.scheduledToday;
    for (const assignment of due) {
      const presetId = assignment.workout_preset_id;
      const name = (
        assignment.workout_preset_name ||
        assignment.session_name ||
        ''
      ).trim();
      if (!presetId || name === '') continue;
      const key = `${plan.id}:${presetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        presetId: String(presetId),
        name,
        planName: plan.plan_name,
        caption,
      });
    }
  }
  return result;
}
