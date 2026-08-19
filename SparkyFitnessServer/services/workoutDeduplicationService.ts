import {
  findMirroredWorkoutDuplicates,
  type WorkoutDeduplicationCandidate,
} from '@workspace/shared';
import reportRepository, {
  type ReportExerciseEntryRow,
} from '../models/reportRepository.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';

export interface WorkoutDuplicateSummary {
  hiddenCount: number;
  hiddenBySource: Record<string, number>;
}

export interface CanonicalWorkoutResult {
  allEntries: ReportExerciseEntryRow[];
  workoutEntries: ReportExerciseEntryRow[];
  duplicateSummary: WorkoutDuplicateSummary;
}

export interface ExerciseCaloriesByDate {
  entry_date: string;
  calories_burned: number;
}

export interface CanonicalWorkoutAggregates {
  total_calories_burned: number;
  workout_count: number;
  active_days: number;
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toCandidate(
  row: ReportExerciseEntryRow
): WorkoutDeduplicationCandidate {
  const elapsedSeconds = finiteNumber(row.elapsed_time_seconds);
  const durationMinutes = finiteNumber(row.duration_minutes);
  return {
    id: row.id,
    source: row.exercise_source,
    activityStartedAt: row.activity_started_at,
    activityEndedAt: row.activity_ended_at,
    activityStartedAtLocal: row.activity_started_at_local,
    durationSeconds:
      elapsedSeconds !== null && elapsedSeconds > 0
        ? elapsedSeconds
        : durationMinutes !== null
          ? durationMinutes * 60
          : null,
  };
}

export function deduplicateWorkoutRows(
  rows: ReportExerciseEntryRow[],
  timezone: string
): CanonicalWorkoutResult {
  const duplicates = findMirroredWorkoutDuplicates(
    rows.map(toCandidate),
    timezone
  );
  const hiddenIds = new Set(
    duplicates.map((duplicate) => duplicate.duplicateId)
  );
  const hiddenBySource: Record<string, number> = {};
  for (const row of rows) {
    if (!hiddenIds.has(row.id)) continue;
    const source = row.exercise_source || 'Unknown';
    hiddenBySource[source] = (hiddenBySource[source] ?? 0) + 1;
  }
  const allEntries = rows.filter((row) => !hiddenIds.has(row.id));
  return {
    allEntries,
    workoutEntries: allEntries.filter(
      (row) => row.exercise_name !== 'Active Calories'
    ),
    duplicateSummary: {
      hiddenCount: hiddenIds.size,
      hiddenBySource,
    },
  };
}

export async function getCanonicalWorkoutEntries(
  userId: string,
  startDate: string,
  endDate: string,
  equipment?: string | null,
  muscle?: string | null,
  exercise?: string | null
): Promise<CanonicalWorkoutResult> {
  const [rows, timezone] = await Promise.all([
    reportRepository.getExerciseEntries(
      userId,
      startDate,
      endDate,
      equipment,
      muscle,
      exercise
    ),
    loadUserTimezone(userId),
  ]);
  return deduplicateWorkoutRows(rows, timezone);
}

export function calculateExerciseCaloriesByDate(
  rows: ReportExerciseEntryRow[]
): ExerciseCaloriesByDate[] {
  const totals = new Map<string, { active: number; workouts: number }>();
  for (const row of rows) {
    const current = totals.get(row.entry_date) ?? { active: 0, workouts: 0 };
    const calories = finiteNumber(row.calories_burned) ?? 0;
    if (row.exercise_name === 'Active Calories') {
      current.active += calories;
    } else {
      current.workouts += calories;
    }
    totals.set(row.entry_date, current);
  }
  return [...totals.entries()]
    .map(([entry_date, total]) => ({
      entry_date,
      calories_burned: Math.max(total.active, total.workouts),
    }))
    .sort((first, second) => first.entry_date.localeCompare(second.entry_date));
}

export function calculateCanonicalWorkoutAggregates(
  rows: ReportExerciseEntryRow[]
): CanonicalWorkoutAggregates {
  const workoutRows = rows.filter(
    (row) => row.exercise_name !== 'Active Calories'
  );
  const workoutKeys = new Set(
    workoutRows.map((row) => row.exercise_preset_entry_id || row.id)
  );
  return {
    total_calories_burned: workoutRows.reduce(
      (sum, row) => sum + (finiteNumber(row.calories_burned) ?? 0),
      0
    ),
    workout_count: workoutKeys.size,
    active_days: new Set(workoutRows.map((row) => row.entry_date)).size,
  };
}

export async function getCanonicalWorkoutAggregates(
  userId: string,
  startDate: string,
  endDate: string
): Promise<CanonicalWorkoutAggregates> {
  const canonical = await getCanonicalWorkoutEntries(
    userId,
    startDate,
    endDate
  );
  return calculateCanonicalWorkoutAggregates(canonical.allEntries);
}

export default {
  deduplicateWorkoutRows,
  getCanonicalWorkoutEntries,
  calculateExerciseCaloriesByDate,
  calculateCanonicalWorkoutAggregates,
  getCanonicalWorkoutAggregates,
};
