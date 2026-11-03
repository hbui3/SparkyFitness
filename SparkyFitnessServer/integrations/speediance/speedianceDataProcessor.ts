import { instantHourMinute, instantToDay } from '@workspace/shared';
import type { PoolClient } from 'pg';
import { getClient } from '../../db/poolManager.js';
import exerciseEntryRepository, {
  EXERCISE_ENTRY_TELEMETRY_COLUMNS,
} from '../../models/exerciseEntry.js';
import exerciseRepository from '../../models/exercise.js';
import activityDetailsRepository from '../../models/activityDetailsRepository.js';
import workoutPresetRepository from '../../models/workoutPresetRepository.js';
import exercisePresetEntryRepository from '../../models/exercisePresetEntryRepository.js';
import { log } from '../../config/logging.js';
import {
  mapSpeedianceSet,
  type SpeedianceExerciseDetail,
  type SpeedianceTrainingRecord,
} from './speedianceMapper.js';

const ENTRY_SOURCE = 'Speediance';

interface ExerciseRow {
  id: string;
  source?: string | null;
  user_id?: string | null;
}

interface WorkoutPresetRow {
  id: number;
  user_id?: string;
  description?: string | null;
}

interface PresetEntryRow {
  id: string;
}

interface ExerciseEntryRow {
  id: string;
}

interface StoredWorkoutRow {
  id: string;
  has_details: boolean;
  workout_preset_id: number | null;
  preset_user_id?: string | null;
  preset_description?: string | null;
  preset_name?: string | null;
}

interface ImportedExercise {
  entry: ExerciseEntryRow;
  exerciseId: string;
  sets: ReturnType<typeof mapSpeedianceSet>[];
}

interface WorkoutTotalRow {
  id: string;
  calories_burned: number | string | null;
  duration_minutes: number | string | null;
  manual_fields: string[] | null;
  watch_duration_minutes: number | string | null;
}

async function reconcileWorkoutTotals(
  client: PoolClient,
  userId: string,
  presetEntryId: string,
  record: SpeedianceTrainingRecord
): Promise<void> {
  const { rows } = await client.query<WorkoutTotalRow>(
    `SELECT id, calories_burned, duration_minutes, manual_fields, watch_duration_minutes
       FROM exercise_entries
      WHERE user_id = $1 AND exercise_preset_entry_id = $2 AND source = $3
      ORDER BY created_at, id
      FOR UPDATE`,
    [userId, presetEntryId, ENTRY_SOURCE]
  );
  const caloriesCarrierId =
    rows.find((row) => row.manual_fields?.includes('calories_burned'))?.id ??
    rows[0]?.id;
  const durationCarrierId =
    rows.find(
      (row) =>
        row.manual_fields?.includes('duration_minutes') ||
        row.watch_duration_minutes !== null
    )?.id ?? rows[0]?.id;
  for (const row of rows) {
    const manualFields = new Set(row.manual_fields ?? []);
    const calories = manualFields.has('calories_burned')
      ? row.calories_burned
      : row.id === caloriesCarrierId
        ? Math.round(record.calorie)
        : 0;
    const duration =
      manualFields.has('duration_minutes') ||
      row.watch_duration_minutes !== null
        ? row.duration_minutes
        : row.id === durationCarrierId
          ? Math.round(record.trainingTime / 60)
          : 0;
    // Every partial response may have a different first exercise. Normalize
    // provider totals across retained rows as well as the rows just imported.
    // Explicit user corrections and recorded watch measurements remain owned
    // by the user/telemetry rather than being replaced by provider totals.
    await client.query(
      `UPDATE exercise_entries SET calories_burned = $1, duration_minutes = $2
        WHERE id = $3 AND user_id = $4 AND exercise_preset_entry_id = $5 AND source = $6`,
      [calories, duration, row.id, userId, presetEntryId, ENTRY_SOURCE]
    );
  }
}

export interface SpeedianceWorkoutBundle {
  record: SpeedianceTrainingRecord;
  exercises: SpeedianceExerciseDetail[];
}

export interface SpeedianceProcessingResult {
  importedWorkouts: number;
  importedExercises: number;
  skippedWorkouts: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sessionExerciseName(record: SpeedianceTrainingRecord): string {
  if (record.type === 1) return 'Speediance Free Lift';
  if (record.type === 7) return 'Speediance Quick Workout';
  return record.title || 'Speediance Workout';
}

async function findOrCreateExercise(
  userId: string,
  detail: SpeedianceExerciseDetail
): Promise<ExerciseRow | null> {
  const exerciseName = detail.actionLibraryName;
  let exercise = (await exerciseRepository.findExerciseByNameAndUserId(
    exerciseName,
    userId
  )) as ExerciseRow | null;
  if (!exercise) {
    exercise = (await exerciseRepository.createExercise({
      user_id: userId,
      name: exerciseName,
      source: ENTRY_SOURCE,
      source_id: detail.actionLibraryGroupId,
      is_custom: true,
      shared_with_public: false,
      primary_muscles: detail.primaryMuscles,
      secondary_muscles: detail.secondaryMuscles,
      modality: detail.completionMethod === 0 ? 'duration' : 'weight_reps',
    })) as ExerciseRow | null;
  } else if (
    exercise.user_id === userId &&
    exercise.source === ENTRY_SOURCE &&
    (detail.primaryMuscles.length > 0 || detail.secondaryMuscles.length > 0)
  ) {
    exercise = (await exerciseRepository.updateExercise(exercise.id, userId, {
      primary_muscles: detail.primaryMuscles,
      secondary_muscles: detail.secondaryMuscles,
      modality: detail.completionMethod === 0 ? 'duration' : 'weight_reps',
    })) as ExerciseRow | null;
  }
  return exercise;
}

async function findOrCreateWorkoutPreset(
  userId: string,
  workoutName: string
): Promise<WorkoutPresetRow> {
  let preset = (await workoutPresetRepository.getWorkoutPresetByName(
    userId,
    workoutName
  )) as WorkoutPresetRow | null;
  if (!preset) {
    preset = (await workoutPresetRepository.createWorkoutPreset({
      user_id: userId,
      name: workoutName,
      description: `Workout imported from Speediance: ${workoutName}`,
      is_public: false,
    })) as WorkoutPresetRow | null;
  }
  if (!preset) {
    throw new Error(`Unable to create workout preset "${workoutName}".`);
  }
  return preset;
}

function isImportedWorkoutPreset(
  preset: WorkoutPresetRow,
  userId: string,
  workoutName: string
): boolean {
  return (
    preset.user_id === userId &&
    preset.description === `Workout imported from Speediance: ${workoutName}`
  );
}

async function createExerciseEntry(
  client: PoolClient,
  userId: string,
  createdByUserId: string,
  record: SpeedianceTrainingRecord,
  detail: SpeedianceExerciseDetail,
  exerciseIndex: number,
  presetEntryId: string,
  sourceId: string,
  timezone: string
): Promise<ImportedExercise> {
  const exercise = await findOrCreateExercise(userId, detail);
  if (!exercise) {
    throw new Error(`Unable to create exercise "${detail.actionLibraryName}".`);
  }

  const startedAt = new Date(record.startTimestamp * 1000);
  const entryDate = instantToDay(startedAt, timezone);
  const { hour, minute } = instantHourMinute(startedAt, timezone);
  const entryTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const sets = detail.finishedReps.map((set, index) =>
    mapSpeedianceSet(set, index, detail.completionMethod, detail.isLeftRight)
  );
  const entryData = {
    exercise_id: exercise.id,
    entry_date: entryDate,
    entry_time: entryTime,
    duration_minutes:
      exerciseIndex === 0 ? Math.round(record.trainingTime / 60) : 0,
    calories_burned: exerciseIndex === 0 ? Math.round(record.calorie) : 0,
    source_id: sourceId,
    exercise_preset_entry_id: presetEntryId,
    notes: `Imported from Speediance training ${record.trainingId}: ${record.title}`,
    entry_source: ENTRY_SOURCE,
    sort_order: exerciseIndex,
    ...(sets.length > 0 ? { sets } : {}),
  };

  const result = (await exerciseEntryRepository._createExerciseEntryWithClient(
    client,
    userId,
    entryData,
    createdByUserId,
    ENTRY_SOURCE,
    presetEntryId
  )) as { entry: ExerciseEntryRow | null; operation: 'created' | 'updated' };
  const entry = result.entry;
  if (!entry) throw new Error('Speediance exercise was not persisted.');

  if (sets.length > 0 || result.operation === 'created') {
    // Raw provider data is optional, but a failed statement must not leave the
    // surrounding workout transaction aborted.
    await client.query('SAVEPOINT speediance_raw_detail');
    try {
      await activityDetailsRepository._deleteActivityDetailsByEntryIdAndProviderWithClient(
        client,
        userId,
        entry.id,
        ENTRY_SOURCE,
        'full_activity_data'
      );
      await activityDetailsRepository._createActivityDetailWithClient(client, {
        user_id: userId,
        exercise_entry_id: entry.id,
        provider_name: ENTRY_SOURCE,
        detail_type: 'full_activity_data',
        detail_data: {
          training: record.raw,
          exercise: detail.raw,
        },
        created_by_user_id: createdByUserId,
        updated_by_user_id: createdByUserId,
      });
      await client.query('RELEASE SAVEPOINT speediance_raw_detail');
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT speediance_raw_detail');
      await client.query('RELEASE SAVEPOINT speediance_raw_detail');
      log(
        'warn',
        `[speedianceDataProcessor] Unable to store raw activity detail for entry ${entry.id}: ${errorMessage(error)}`
      );
    }
  }

  return { entry, exerciseId: exercise.id, sets };
}

async function processWorkout(
  userId: string,
  createdByUserId: string,
  bundle: SpeedianceWorkoutBundle,
  timezone: string
): Promise<{ importedExercises: number; skipped: boolean }> {
  const { record } = bundle;
  let workoutPresetId: number;
  const entryDate = instantToDay(
    new Date(record.startTimestamp * 1000),
    timezone
  );
  const exercises =
    bundle.exercises.length > 0
      ? bundle.exercises
      : [
          {
            actionLibraryName: sessionExerciseName(record),
            actionLibraryId: null,
            actionLibraryGroupId: null,
            completionMethod: null,
            isLeftRight: false,
            totalCapacity: record.totalCapacity,
            maxWeight: null,
            primaryMuscles: [],
            secondaryMuscles: [],
            finishedReps: [],
            raw: record.raw,
          },
        ];

  const client: PoolClient = await getClient(userId);
  const imported: ImportedExercise[] = [];
  let shouldReconcilePlan: boolean;
  let populateImportedPreset: boolean;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `exercise-entry-sync:${userId}:${ENTRY_SOURCE}`,
    ]);
    const { rows: existing } = await client.query<StoredWorkoutRow>(
      `SELECT epe.id, epe.workout_preset_id,
              wp.user_id AS preset_user_id,
              wp.description AS preset_description, wp.name AS preset_name,
              EXISTS (
                SELECT 1 FROM exercise_entries ee
                WHERE ee.exercise_preset_entry_id = epe.id AND ee.user_id = $1
                  AND (ee.source_id <> $4 OR EXISTS (
                    SELECT 1 FROM exercise_entry_sets ees
                    WHERE ees.exercise_entry_id = ee.id
                  ))
              ) AS has_details
         FROM exercise_preset_entries epe
         LEFT JOIN workout_presets wp ON wp.id = epe.workout_preset_id
        WHERE epe.user_id = $1 AND epe.source = $2
          AND (epe.notes = $5 OR EXISTS (
            SELECT 1 FROM exercise_entries ee
            WHERE ee.exercise_preset_entry_id = epe.id AND ee.user_id = $1
              AND ee.source = $2 AND left(ee.source_id, length($3)) = $3
          ))
        ORDER BY epe.created_at, epe.id
        FOR UPDATE OF epe`,
      [
        userId,
        ENTRY_SOURCE,
        `${record.trainingId}:`,
        `${record.trainingId}:0`,
        `Speediance training ID: ${record.trainingId}`,
      ]
    );
    const incomingSetCount = bundle.exercises.reduce(
      (total, exercise) => total + exercise.finishedReps.length,
      0
    );
    if (
      existing.some((workout) => workout.has_details) &&
      incomingSetCount === 0
    ) {
      await client.query('COMMIT');
      log(
        'warn',
        `[speedianceDataProcessor] Retaining stored detail for training ${record.trainingId}; the provider did not return its sets.`
      );
      return { importedExercises: 0, skipped: true };
    }
    shouldReconcilePlan = !existing.some((workout) => workout.has_details);
    if (existing[0]?.workout_preset_id) {
      workoutPresetId = existing[0].workout_preset_id;
      populateImportedPreset = isImportedWorkoutPreset(
        {
          id: workoutPresetId,
          user_id: existing[0].preset_user_id ?? undefined,
          description: existing[0].preset_description,
        },
        userId,
        existing[0].preset_name ?? record.title
      );
    } else {
      const preset = await findOrCreateWorkoutPreset(userId, record.title);
      workoutPresetId = preset.id;
      populateImportedPreset = isImportedWorkoutPreset(
        preset,
        userId,
        record.title
      );
    }
    if (existing[0]) {
      await exercisePresetEntryRepository.updateExercisePresetEntryWithClient(
        client,
        existing[0].id,
        userId,
        { entry_date: entryDate }
      );
    }
    const presetEntry =
      existing[0] ??
      ((await exercisePresetEntryRepository.createExercisePresetEntryWithClient(
        client,
        userId,
        {
          workout_preset_id: workoutPresetId,
          name: record.title,
          description: `Speediance workout type ${record.type}`,
          entry_date: entryDate,
          notes: `Speediance training ID: ${record.trainingId}`,
          source: ENTRY_SOURCE,
        },
        createdByUserId
      )) as PresetEntryRow | null);
    if (!presetEntry) throw new Error('Speediance workout was not persisted.');
    const occurrences = new Map<string, number>();
    for (let index = 0; index < exercises.length; index++) {
      const detail = exercises[index];
      if (!detail) continue;
      const sourcePart = detail.actionLibraryGroupId ?? String(index);
      const occurrence = occurrences.get(sourcePart) ?? 0;
      occurrences.set(sourcePart, occurrence + 1);
      const sourceId = `${record.trainingId}:${sourcePart}${occurrence > 0 ? `:${occurrence}` : ''}`;
      imported.push(
        await createExerciseEntry(
          client,
          userId,
          createdByUserId,
          record,
          detail,
          index,
          presetEntry.id,
          sourceId,
          timezone
        )
      );
    }

    if (bundle.exercises.length > 0 && incomingSetCount > 0) {
      // An earlier summary can be replaced by real sets, but an incomplete
      // provider response must never delete other already imported exercises.
      await client.query(
        `DELETE FROM exercise_entries
          WHERE user_id = $1 AND source = $2 AND source_id = $3
            AND NOT (id = ANY($4::uuid[]))
            AND COALESCE(cardinality(manual_fields), 0) = 0
            AND watch_duration_minutes IS NULL
            AND notes = $5
            AND avg_heart_rate IS NULL AND distance IS NULL
            AND ${EXERCISE_ENTRY_TELEMETRY_COLUMNS.map((column) => `${column} IS NULL`).join(' AND ')}
            AND NOT EXISTS (SELECT 1 FROM exercise_entry_sets ees
                            WHERE ees.exercise_entry_id = exercise_entries.id)
            AND NOT EXISTS (SELECT 1 FROM exercise_entry_laps laps
                            WHERE laps.exercise_entry_id = exercise_entries.id)
            AND NOT EXISTS (SELECT 1 FROM exercise_entry_hr_zones zones
                            WHERE zones.exercise_entry_id = exercise_entries.id)
            AND NOT EXISTS (SELECT 1 FROM exercise_entry_gps_points gps
                            WHERE gps.exercise_entry_id = exercise_entries.id)
            AND NOT EXISTS (SELECT 1 FROM exercise_entry_distance_series series
                            WHERE series.exercise_entry_id = exercise_entries.id)
            AND NOT EXISTS (SELECT 1 FROM exercise_entry_activity_details details
                            WHERE details.exercise_entry_id = exercise_entries.id
                              AND details.provider_name <> $2)`,
        [
          userId,
          ENTRY_SOURCE,
          `${record.trainingId}:0`,
          imported.map((item) => item.entry.id),
          `Imported from Speediance training ${record.trainingId}: ${record.title}`,
        ]
      );
    }
    await reconcileWorkoutTotals(client, userId, presetEntry.id, record);
    await client.query(
      `DELETE FROM exercise_preset_entries epe
        WHERE epe.user_id = $1 AND epe.source = $2
          AND epe.id = ANY($3::uuid[]) AND epe.id <> $4
          AND NOT EXISTS (SELECT 1 FROM exercise_entries ee
                          WHERE ee.exercise_preset_entry_id = epe.id)`,
      [
        userId,
        ENTRY_SOURCE,
        existing.map((workout) => workout.id),
        presetEntry.id,
      ]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // Reusable library data and plan cleanup cannot make a successfully stored
  // workout disappear if those optional follow-up operations fail.
  for (const [index, exercise] of (populateImportedPreset
    ? imported
    : []
  ).entries()) {
    try {
      await workoutPresetRepository.addExerciseToWorkoutPreset(
        userId,
        workoutPresetId,
        exercise.exerciseId,
        null,
        exercise.sets,
        index
      );
    } catch (error) {
      log(
        'warn',
        `[speedianceDataProcessor] Unable to update reusable preset for training ${record.trainingId}: ${errorMessage(error)}`
      );
    }
  }
  if (
    shouldReconcilePlan &&
    bundle.exercises.length > 0 &&
    imported.length > 0
  ) {
    try {
      await exercisePresetEntryRepository.deleteOnePlannedPresetEntry(
        userId,
        workoutPresetId,
        entryDate
      );
    } catch (error) {
      log(
        'warn',
        `[speedianceDataProcessor] Imported training ${record.trainingId}, but could not reconcile its planned session: ${errorMessage(error)}`
      );
    }
  }
  return { importedExercises: imported.length, skipped: false };
}

export async function processSpeedianceWorkouts(
  userId: string,
  createdByUserId: string,
  bundles: SpeedianceWorkoutBundle[],
  startDate: string,
  endDate: string,
  timezone: string
): Promise<SpeedianceProcessingResult> {
  let importedWorkouts = 0;
  let importedExercises = 0;
  let skippedWorkouts = 0;
  const seenIds = new Set<string>();
  for (const bundle of bundles) {
    if (seenIds.has(bundle.record.trainingId)) continue;
    seenIds.add(bundle.record.trainingId);
    const entryDate = instantToDay(
      new Date(bundle.record.startTimestamp * 1000),
      timezone
    );
    if (entryDate < startDate || entryDate > endDate) continue;
    try {
      const result = await processWorkout(
        userId,
        createdByUserId,
        bundle,
        timezone
      );
      importedExercises += result.importedExercises;
      if (result.skipped) skippedWorkouts++;
      else importedWorkouts++;
    } catch (error) {
      skippedWorkouts++;
      log(
        'error',
        `[speedianceDataProcessor] Training ${bundle.record.trainingId} could not be imported: ${errorMessage(error)}`
      );
    }
  }

  return { importedWorkouts, importedExercises, skippedWorkouts };
}
