import { addDays } from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import { log } from '../config/logging.js';
import exerciseService from './exerciseService.js';
import speedianceWorkoutService from '../integrations/speediance/speedianceWorkoutService.js';

export interface PlannedWorkoutStatusItem {
  name: string;
  date: string;
  workoutPresetId: number;
  workoutPlanAssignmentId: number | null;
  completed: boolean;
}

export interface PlannedWorkoutScheduleStatus {
  dueToday: PlannedWorkoutStatusItem[];
  completedToday: PlannedWorkoutStatusItem[];
  missedYesterday: PlannedWorkoutStatusItem[];
  carriedForwardToday: PlannedWorkoutStatusItem[];
}

interface PlannedWorkoutRow {
  name: string;
  entry_date: string;
  workout_preset_id: number;
  workout_plan_assignment_id: number | null;
  source: string;
  completed: boolean;
}

function statusItem(row: PlannedWorkoutRow): PlannedWorkoutStatusItem {
  return {
    name: row.name,
    date: row.entry_date,
    workoutPresetId: row.workout_preset_id,
    workoutPlanAssignmentId: row.workout_plan_assignment_id,
    completed: row.completed,
  };
}

async function loadRows(
  userId: string,
  startDate: string,
  endDate: string
): Promise<PlannedWorkoutRow[]> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT
         epe.name,
         epe.entry_date::text AS entry_date,
         epe.workout_preset_id,
         MIN(ee.workout_plan_assignment_id) AS workout_plan_assignment_id,
         epe.source,
         (COUNT(ees.id) > 0 AND BOOL_AND(ees.completed_at IS NOT NULL)) AS completed
       FROM exercise_preset_entries epe
       LEFT JOIN exercise_entries ee
         ON ee.exercise_preset_entry_id = epe.id
        AND ee.user_id = epe.user_id
       LEFT JOIN exercise_entry_sets ees ON ees.exercise_entry_id = ee.id
       WHERE epe.user_id = $1
         AND epe.entry_date BETWEEN $2 AND $3
         AND epe.workout_preset_id IS NOT NULL
         AND epe.source IN ('Workout Plan', 'Speediance')
       GROUP BY epe.id, epe.name, epe.entry_date, epe.workout_preset_id, epe.source
       ORDER BY epe.entry_date, epe.created_at`,
      [userId, startDate, endDate]
    );
    return result.rows as PlannedWorkoutRow[];
  } finally {
    client.release();
  }
}

export async function getPlannedWorkoutScheduleStatus(
  userId: string,
  today: string
): Promise<PlannedWorkoutScheduleStatus> {
  const yesterday = addDays(today, -1);
  const rows = await loadRows(userId, yesterday, today);
  const dueToday = rows
    .filter(
      (row) =>
        row.entry_date === today &&
        row.source === 'Workout Plan' &&
        !row.completed
    )
    .map(statusItem);
  const completedToday = rows
    .filter(
      (row) =>
        row.entry_date === today &&
        (row.source === 'Speediance' || row.completed)
    )
    .map(statusItem);
  const missedYesterday = rows
    .filter(
      (row) =>
        row.entry_date === yesterday &&
        row.source === 'Workout Plan' &&
        !row.completed
    )
    .map(statusItem);
  return {
    dueToday,
    completedToday,
    missedYesterday,
    carriedForwardToday: [],
  };
}

export async function carryForwardMissedWorkouts(
  userId: string,
  today: string
): Promise<PlannedWorkoutStatusItem[]> {
  const status = await getPlannedWorkoutScheduleStatus(userId, today);
  if (status.missedYesterday.length === 0) return [];
  const carried: PlannedWorkoutStatusItem[] = [];
  for (const missed of status.missedYesterday) {
    const alreadyDue = status.dueToday.some(
      (item) => item.workoutPresetId === missed.workoutPresetId
    );
    if (alreadyDue) continue;
    await exerciseService.logWorkoutPresetGrouped(
      userId,
      userId,
      missed.workoutPresetId,
      today,
      {
        source: 'Workout Plan',
        workoutPlanAssignmentId: missed.workoutPlanAssignmentId,
        notes: `Carried forward from ${missed.date} after the planned workout was missed.`,
      }
    );
    const carriedItem = { ...missed, date: today };
    carried.push(carriedItem);
  }

  if (carried.length > 0) {
    try {
      const remote =
        await speedianceWorkoutService.listSpeedianceWorkouts(userId);
      for (const item of carried) {
        const workout = remote.workouts.find(
          (candidate) => candidate.name === item.name
        );
        if (!workout) continue;
        await speedianceWorkoutService.setSpeedianceWorkoutSchedule(
          userId,
          workout.code,
          today,
          true
        );
      }
    } catch (error) {
      log(
        'warn',
        `[plannedWorkoutScheduleService] Workout was carried forward in Sparky, but Speediance scheduling could not be verified: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return carried;
}

export default {
  getPlannedWorkoutScheduleStatus,
  carryForwardMissedWorkouts,
};
