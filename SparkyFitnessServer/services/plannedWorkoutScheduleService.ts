import {
  addDays,
  cycleWeekIndex,
  dayOfWeek,
  type ActiveTrainingPlan,
  type TrainingDaySummary,
  type TrainingTimelineItem,
  type TrainingTimelineResponse,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import { log } from '../config/logging.js';
import exerciseService from './exerciseService.js';
import speedianceWorkoutService from '../integrations/speediance/speedianceWorkoutService.js';
import workoutDeduplicationService from './workoutDeduplicationService.js';

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
  id: string;
  name: string;
  entry_date: string;
  workout_preset_id: number | null;
  workout_plan_assignment_id: number | null;
  source: string;
  completed: boolean;
  exercise_count: number | string;
  total_set_count: number | string;
  warmup_set_count: number | string;
  completed_exercise_count: number | string;
  completed_set_count: number | string;
  completed_warmup_set_count: number | string;
}

interface ActivePlanRow {
  plan_id: number;
  plan_name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  cycle_length_weeks: number;
  schedule_type: 'weekly' | 'sequential' | null;
  assignment_id: number | null;
  day_of_week: number | null;
  week_index: number;
  session_index: number | null;
  session_name: string | null;
  workout_preset_id: number | null;
  workout_name: string;
  exercise_count: number | string;
  total_set_count: number | string;
  warmup_set_count: number | string;
}

function statusItem(
  row: PlannedWorkoutRow & { workout_preset_id: number }
): PlannedWorkoutStatusItem {
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
         epe.id,
         epe.name,
         epe.entry_date::text AS entry_date,
         epe.workout_preset_id,
         MIN(ee.workout_plan_assignment_id) AS workout_plan_assignment_id,
         epe.source,
         (COUNT(ees.id) > 0 AND BOOL_AND(ees.completed_at IS NOT NULL)) AS completed,
         COUNT(DISTINCT ee.id) FILTER (WHERE ee.exercise_id IS NOT NULL) AS exercise_count,
         COUNT(ees.id) AS total_set_count,
         COUNT(ees.id) FILTER (
           WHERE LOWER(COALESCE(ees.set_type, '')) LIKE '%warm%'
         ) AS warmup_set_count,
         COUNT(DISTINCT ee.id) FILTER (
           WHERE ee.exercise_id IS NOT NULL AND ees.completed_at IS NOT NULL
         ) AS completed_exercise_count,
         COUNT(ees.id) FILTER (
           WHERE ees.completed_at IS NOT NULL
         ) AS completed_set_count,
         COUNT(ees.id) FILTER (
           WHERE ees.completed_at IS NOT NULL
             AND LOWER(COALESCE(ees.set_type, '')) LIKE '%warm%'
         ) AS completed_warmup_set_count
       FROM exercise_preset_entries epe
       LEFT JOIN exercise_entries ee
         ON ee.exercise_preset_entry_id = epe.id
        AND ee.user_id = epe.user_id
       LEFT JOIN exercise_entry_sets ees ON ees.exercise_entry_id = ee.id
       WHERE epe.user_id = $1
         AND epe.entry_date BETWEEN $2 AND $3
       GROUP BY epe.id, epe.name, epe.entry_date, epe.workout_preset_id, epe.source
       UNION ALL
       SELECT
         ee.id, ee.exercise_name AS name, ee.entry_date::text AS entry_date,
         NULL AS workout_preset_id, ee.workout_plan_assignment_id, ee.source,
         (COUNT(ees.id) > 0 AND BOOL_AND(ees.completed_at IS NOT NULL)) AS completed,
         1 AS exercise_count, COUNT(ees.id) AS total_set_count,
         COUNT(ees.id) FILTER (WHERE LOWER(COALESCE(ees.set_type, '')) LIKE '%warm%') AS warmup_set_count,
         CASE WHEN COUNT(ees.id) FILTER (WHERE ees.completed_at IS NOT NULL) > 0 THEN 1 ELSE 0 END AS completed_exercise_count,
         COUNT(ees.id) FILTER (WHERE ees.completed_at IS NOT NULL) AS completed_set_count,
         COUNT(ees.id) FILTER (WHERE ees.completed_at IS NOT NULL AND LOWER(COALESCE(ees.set_type, '')) LIKE '%warm%') AS completed_warmup_set_count
       FROM exercise_entries ee
       LEFT JOIN exercise_entry_sets ees ON ees.exercise_entry_id = ee.id
       WHERE ee.user_id = $1 AND ee.entry_date BETWEEN $2 AND $3
         AND ee.exercise_preset_entry_id IS NULL
         AND ee.workout_plan_assignment_id IS NOT NULL
       GROUP BY ee.id
       ORDER BY entry_date, id`,
      [userId, startDate, endDate]
    );
    return result.rows as PlannedWorkoutRow[];
  } finally {
    client.release();
  }
}

function count(value: number | string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function timelineItem(
  row: PlannedWorkoutRow,
  status: TrainingTimelineItem['status']
): TrainingTimelineItem {
  const totalSetCount = count(row.total_set_count);
  const warmupSetCount = count(row.warmup_set_count);
  return {
    id: row.id,
    date: row.entry_date,
    name: row.name,
    source: row.source || 'Unknown',
    status,
    workoutPresetId: row.workout_preset_id,
    workoutPlanAssignmentId: row.workout_plan_assignment_id,
    exerciseCount: count(row.exercise_count),
    totalSetCount,
    warmupSetCount,
    workingSetCount: Math.max(0, totalSetCount - warmupSetCount),
  };
}

async function loadActivePlans(userId: string): Promise<ActiveTrainingPlan[]> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT
         wpt.id AS plan_id,
         wpt.plan_name,
         wpt.description,
         wpt.start_date::text AS start_date,
         wpt.end_date::text AS end_date,
         wpt.cycle_length_weeks,
         wpt.schedule_type,
         wpta.id AS assignment_id,
         wpta.day_of_week,
         wpta.week_index,
         wpta.session_index,
         wpta.session_name,
         wpta.workout_preset_id,
         COALESCE(wp.name, e.name, 'Workout') AS workout_name,
         COUNT(DISTINCT wpe.id) + COUNT(DISTINCT wpta.exercise_id) AS exercise_count,
         COUNT(DISTINCT wpes.id) + COUNT(DISTINCT wpas.id) AS total_set_count,
         COUNT(DISTINCT wpes.id) FILTER (
           WHERE LOWER(COALESCE(wpes.set_type, '')) LIKE '%warm%'
         ) + COUNT(DISTINCT wpas.id) FILTER (
           WHERE LOWER(COALESCE(wpas.set_type, '')) LIKE '%warm%'
         ) AS warmup_set_count
       FROM workout_plan_templates wpt
       JOIN workout_plan_template_assignments wpta ON wpta.template_id = wpt.id
       LEFT JOIN workout_presets wp ON wp.id = wpta.workout_preset_id
       LEFT JOIN workout_preset_exercises wpe ON wpe.workout_preset_id = wp.id
       LEFT JOIN workout_preset_exercise_sets wpes ON wpes.workout_preset_exercise_id = wpe.id
       LEFT JOIN exercises e ON e.id = wpta.exercise_id
       LEFT JOIN workout_plan_assignment_sets wpas ON wpas.assignment_id = wpta.id
       WHERE wpt.user_id = $1 AND wpt.is_active = TRUE
       GROUP BY
         wpt.id, wpt.plan_name, wpt.description, wpt.start_date, wpt.end_date,
         wpt.cycle_length_weeks, wpt.schedule_type,
         wpta.id, wpta.day_of_week, wpta.week_index, wpta.session_index, wpta.session_name,
         wpta.workout_preset_id, wp.name, e.name
       ORDER BY wpt.start_date, wpt.id, wpta.session_index, wpta.week_index, wpta.day_of_week, wpta.sort_order, wpta.id`,
      [userId]
    );
    const plans = new Map<number, ActiveTrainingPlan>();
    for (const row of result.rows as ActivePlanRow[]) {
      let plan = plans.get(row.plan_id);
      if (!plan) {
        plan = {
          id: row.plan_id,
          name: row.plan_name,
          description: row.description,
          startDate: row.start_date,
          endDate: row.end_date,
          scheduleType:
            row.schedule_type === 'sequential' ? 'sequential' : 'weekly',
          cycleLengthWeeks: Math.max(1, Number(row.cycle_length_weeks) || 1),
          assignments: [],
        };
        plans.set(row.plan_id, plan);
      }
      const totalSetCount = count(row.total_set_count);
      const warmupSetCount = count(row.warmup_set_count);
      plan.assignments.push({
        assignmentId: row.assignment_id ?? null,
        dayOfWeek: row.day_of_week,
        weekIndex: Math.max(0, Number(row.week_index) || 0),
        sessionIndex: row.session_index ?? null,
        sessionName: row.session_name ?? null,
        presetId: row.workout_preset_id,
        workoutName: row.workout_name,
        exerciseCount: count(row.exercise_count),
        totalSetCount,
        warmupSetCount,
        workingSetCount: Math.max(0, totalSetCount - warmupSetCount),
      });
    }
    return [...plans.values()];
  } finally {
    client.release();
  }
}

function setType(set: Record<string, unknown>): string {
  const value = set.set_type ?? set.setType;
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function scheduledRowKey(row: PlannedWorkoutRow): string {
  if (row.workout_plan_assignment_id !== null) {
    return `${row.entry_date}:assignment:${row.workout_plan_assignment_id}`;
  }
  return `${row.entry_date}:entry:${row.id}`;
}

function scheduledRowsByKey(
  rows: PlannedWorkoutRow[]
): Map<string, PlannedWorkoutRow> {
  const result = new Map<string, PlannedWorkoutRow>();
  for (const row of rows.filter(
    (candidate) => candidate.source === 'Workout Plan'
  )) {
    const key = scheduledRowKey(row);
    const existing = result.get(key);
    if (
      !existing ||
      count(row.total_set_count) > count(existing.total_set_count)
    ) {
      result.set(key, row);
    }
  }
  return result;
}

/** Reading a prompt-mode plan must show its dates without writing diary entries. */
function projectWeeklyRows(
  rows: PlannedWorkoutRow[],
  plans: ActiveTrainingPlan[],
  rangeStart: string,
  rangeEnd: string
): PlannedWorkoutRow[] {
  const result = [...rows];
  const materialized = scheduledRowsByKey(rows);
  for (const plan of plans) {
    if (plan.scheduleType === 'sequential') continue;
    const first = rangeStart < plan.startDate ? plan.startDate : rangeStart;
    const last =
      plan.endDate !== null && plan.endDate < rangeEnd
        ? plan.endDate
        : rangeEnd;
    for (let date = first; date <= last; date = addDays(date, 1)) {
      const weekday = dayOfWeek(date);
      const cycleWeek = cycleWeekIndex(
        plan.startDate,
        date,
        plan.cycleLengthWeeks
      );
      for (const assignment of plan.assignments) {
        if (
          assignment.assignmentId === null ||
          assignment.assignmentId === undefined ||
          assignment.dayOfWeek !== weekday ||
          assignment.weekIndex !== cycleWeek
        )
          continue;
        const row: PlannedWorkoutRow = {
          id: `plan:${plan.id}:${assignment.assignmentId}:${date}`,
          name: assignment.workoutName,
          entry_date: date,
          workout_preset_id: assignment.presetId,
          workout_plan_assignment_id: assignment.assignmentId,
          source: 'Workout Plan',
          completed: false,
          exercise_count: assignment.exerciseCount,
          total_set_count: assignment.totalSetCount,
          warmup_set_count: assignment.warmupSetCount,
          completed_exercise_count: 0,
          completed_set_count: 0,
          completed_warmup_set_count: 0,
        };
        if (materialized.has(scheduledRowKey(row))) continue;
        result.push(row);
        materialized.set(scheduledRowKey(row), row);
      }
    }
  }
  return result;
}

function matchesCompleted(
  row: PlannedWorkoutRow,
  completed: TrainingTimelineItem
): boolean {
  if (row.entry_date !== completed.date) return false;
  if (row.id === completed.id) return true;
  if (
    row.workout_plan_assignment_id !== null &&
    completed.workoutPlanAssignmentId !== null
  ) {
    return row.workout_plan_assignment_id === completed.workoutPlanAssignmentId;
  }
  if (row.workout_preset_id !== null && completed.workoutPresetId !== null) {
    return row.workout_preset_id === completed.workoutPresetId;
  }
  return (
    row.name.trim().toLocaleLowerCase() ===
    completed.name.trim().toLocaleLowerCase()
  );
}

/** One completed workout satisfies at most one scheduled slot. */
function matchCompletedRows(
  scheduled: Map<string, PlannedWorkoutRow>,
  completedItems: TrainingTimelineItem[]
): Map<string, TrainingTimelineItem> {
  const matches = new Map<string, TrainingTimelineItem>();
  const remaining = [...completedItems];
  for (const [key, row] of scheduled) {
    const candidates = remaining.filter((item) => matchesCompleted(row, item));
    const match =
      candidates.find((item) => item.id === row.id) ??
      candidates.find(
        (item) =>
          row.workout_plan_assignment_id !== null &&
          item.workoutPlanAssignmentId === row.workout_plan_assignment_id
      ) ??
      candidates[0];
    if (!match) continue;
    matches.set(key, match);
    remaining.splice(remaining.indexOf(match), 1);
  }
  return matches;
}

function buildDaySummaries(
  today: string,
  rows: PlannedWorkoutRow[],
  items: TrainingTimelineItem[]
): TrainingDaySummary[] {
  const scheduled = scheduledRowsByKey(rows);
  const completedItems = items.filter((item) => item.status === 'completed');
  const completedMatches = matchCompletedRows(scheduled, completedItems);
  const dates = new Set([
    ...[...scheduled.values()].map((row) => row.entry_date),
    ...completedItems.map((item) => item.date),
  ]);
  return [...dates].sort().map((date): TrainingDaySummary => {
    const scheduledForDay = [...scheduled].filter(
      ([, row]) => row.entry_date === date
    );
    const completedForDay = completedItems.filter((item) => item.date === date);
    let completedScheduledWorkoutCount = 0;
    let scheduledExerciseCount = 0;
    let completedScheduledExerciseCount = 0;
    let scheduledSetCount = 0;
    let completedScheduledSetCount = 0;
    let scheduledWarmupSetCount = 0;
    let completedScheduledWarmupSetCount = 0;
    for (const [key, row] of scheduledForDay) {
      const completed = completedMatches.get(key);
      scheduledExerciseCount += count(row.exercise_count);
      scheduledSetCount += count(row.total_set_count);
      scheduledWarmupSetCount += count(row.warmup_set_count);
      if (completed) {
        completedScheduledWorkoutCount++;
        completedScheduledExerciseCount += Math.min(
          count(row.exercise_count),
          completed.exerciseCount
        );
        completedScheduledSetCount += Math.min(
          count(row.total_set_count),
          completed.totalSetCount
        );
        completedScheduledWarmupSetCount += Math.min(
          count(row.warmup_set_count),
          completed.warmupSetCount
        );
      } else {
        completedScheduledExerciseCount += count(row.completed_exercise_count);
        completedScheduledSetCount += count(row.completed_set_count);
        completedScheduledWarmupSetCount += count(
          row.completed_warmup_set_count
        );
      }
    }
    const scheduledWorkoutCount = scheduledForDay.length;
    const hasPartialProgress =
      completedScheduledWorkoutCount > 0 ||
      completedScheduledExerciseCount > 0 ||
      completedScheduledSetCount > 0;
    const status: TrainingDaySummary['status'] =
      scheduledWorkoutCount === 0 ||
      completedScheduledWorkoutCount >= scheduledWorkoutCount
        ? 'completed'
        : hasPartialProgress
          ? 'in_progress'
          : date < today
            ? 'missed'
            : 'planned';
    return {
      date,
      status,
      scheduledWorkoutCount,
      completedScheduledWorkoutCount,
      completedWorkoutCount: completedForDay.length,
      scheduledExerciseCount,
      completedScheduledExerciseCount: Math.min(
        scheduledExerciseCount,
        completedScheduledExerciseCount
      ),
      scheduledSetCount,
      completedScheduledSetCount: Math.min(
        scheduledSetCount,
        completedScheduledSetCount
      ),
      scheduledWarmupSetCount,
      completedScheduledWarmupSetCount: Math.min(
        scheduledWarmupSetCount,
        completedScheduledWarmupSetCount
      ),
      scheduledNames: unique(scheduledForDay.map(([, row]) => row.name)),
      completedNames: unique(completedForDay.map((item) => item.name)),
      sources: unique([
        ...scheduledForDay.map(([, row]) => row.source),
        ...completedForDay.map((item) => item.source),
      ]),
    };
  });
}

/**
 * Returns the canonical workout chronology used by both the web UI and coach.
 * Provider-owned raw rows stay stored; canonical workout reads hide mirrored
 * HealthKit/Health Connect copies before the chronology is assembled.
 */
export async function getTrainingTimeline(
  userId: string,
  today: string,
  historyDays = 30,
  futureDays = 120
): Promise<TrainingTimelineResponse> {
  const rangeStart = addDays(today, -historyDays);
  const rangeEnd = addDays(today, futureDays);
  return getTrainingTimelineForRange(userId, today, rangeStart, rangeEnd);
}

export async function getTrainingTimelineForRange(
  userId: string,
  today: string,
  rangeStart: string,
  rangeEnd: string
): Promise<TrainingTimelineResponse> {
  const [storedRows, activePlans] = await Promise.all([
    loadRows(userId, rangeStart, rangeEnd),
    loadActivePlans(userId),
  ]);
  const rows = projectWeeklyRows(storedRows, activePlans, rangeStart, rangeEnd);
  const canonical =
    rangeStart <= today
      ? await workoutDeduplicationService.getCanonicalWorkoutEntries(
          userId,
          rangeStart,
          rangeEnd < today ? rangeEnd : today
        )
      : { workoutEntries: [] };
  const canonicalParentIds = new Set(
    canonical.workoutEntries
      .map((row) => row.exercise_preset_entry_id)
      .filter((id): id is string => typeof id === 'string')
  );

  const canonicalEntryIds = new Set(
    canonical.workoutEntries.map((entry) => entry.id)
  );
  const completed = rows
    .filter(
      (row) =>
        row.entry_date <= today &&
        (canonicalParentIds.has(row.id) ||
          canonicalEntryIds.has(row.id) ||
          (row.source === 'Workout Plan' && row.completed)) &&
        (row.source !== 'Workout Plan' || row.completed)
    )
    .map((row) => timelineItem(row, 'completed'));
  const parentIds = new Set(rows.map((row) => row.id));
  const standalone = canonical.workoutEntries
    .filter(
      (row) =>
        !parentIds.has(row.id) &&
        (!row.exercise_preset_entry_id ||
          !parentIds.has(row.exercise_preset_entry_id))
    )
    .map((row) => {
      const sets = Array.isArray(row.sets) ? row.sets : [];
      const warmupSetCount = sets.filter((set) =>
        setType(set).includes('warm')
      ).length;
      return {
        id: row.id,
        date: row.entry_date,
        name: row.exercise_name,
        source: row.exercise_source || 'Unknown',
        status: 'completed' as const,
        workoutPresetId: null,
        workoutPlanAssignmentId:
          typeof row.workout_plan_assignment_id === 'number'
            ? row.workout_plan_assignment_id
            : null,
        exerciseCount: 1,
        totalSetCount: sets.length,
        warmupSetCount,
        workingSetCount: Math.max(0, sets.length - warmupSetCount),
      };
    });

  const scheduled = scheduledRowsByKey(rows);
  const completedMatches = matchCompletedRows(scheduled, [
    ...completed,
    ...standalone,
  ]);
  const planned = [...scheduled]
    .filter(([key, row]) => !row.completed && !completedMatches.has(key))
    .map(([, row]) =>
      timelineItem(row, row.entry_date < today ? 'missed' : 'planned')
    );
  const items = [...completed, ...planned, ...standalone].sort(
    (first, second) =>
      first.date.localeCompare(second.date) ||
      first.name.localeCompare(second.name)
  );
  return {
    today,
    rangeStart,
    rangeEnd,
    activePlans,
    items,
    days: buildDaySummaries(today, rows, items),
  };
}

export async function getPlannedWorkoutScheduleStatus(
  userId: string,
  today: string
): Promise<PlannedWorkoutScheduleStatus> {
  const yesterday = addDays(today, -1);
  const rows = await loadRows(userId, yesterday, today);
  const dueToday = rows
    .filter(
      (row): row is PlannedWorkoutRow & { workout_preset_id: number } =>
        row.entry_date === today &&
        row.source === 'Workout Plan' &&
        row.workout_preset_id !== null &&
        !row.completed
    )
    .map(statusItem);
  const completedToday = rows
    .filter(
      (row): row is PlannedWorkoutRow & { workout_preset_id: number } =>
        row.entry_date === today &&
        row.workout_preset_id !== null &&
        (row.source === 'Speediance' || row.completed)
    )
    .map(statusItem);
  const missedYesterday = rows
    .filter(
      (row): row is PlannedWorkoutRow & { workout_preset_id: number } =>
        row.entry_date === yesterday &&
        row.source === 'Workout Plan' &&
        row.workout_preset_id !== null &&
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
    const alreadyHandled = [
      ...status.dueToday,
      ...status.completedToday,
      ...carried,
    ].some((item) => item.workoutPresetId === missed.workoutPresetId);
    if (alreadyHandled) continue;
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
  getTrainingTimeline,
  getTrainingTimelineForRange,
  carryForwardMissedWorkouts,
};
