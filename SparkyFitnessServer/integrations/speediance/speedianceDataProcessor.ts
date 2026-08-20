import { instantHourMinute, instantToDay } from '@workspace/shared';
import exerciseEntryRepository from '../../models/exerciseEntry.js';
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
}

interface PresetEntryRow {
  id: string;
}

interface ExerciseEntryRow {
  id: string;
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

async function createExerciseEntry(
  userId: string,
  createdByUserId: string,
  record: SpeedianceTrainingRecord,
  detail: SpeedianceExerciseDetail,
  exerciseIndex: number,
  presetEntryId: string,
  workoutPresetId: number,
  timezone: string
): Promise<ExerciseEntryRow | null> {
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
  const sourcePart = detail.actionLibraryGroupId ?? String(exerciseIndex);
  const entryData = {
    exercise_id: exercise.id,
    entry_date: entryDate,
    entry_time: entryTime,
    duration_minutes:
      exerciseIndex === 0 ? Math.round(record.trainingTime / 60) : 0,
    calories_burned: exerciseIndex === 0 ? Math.round(record.calorie) : 0,
    source_id: `${record.trainingId}:${sourcePart}`,
    exercise_preset_entry_id: presetEntryId,
    notes: `Imported from Speediance training ${record.trainingId}: ${record.title}`,
    entry_source: ENTRY_SOURCE,
    sort_order: exerciseIndex,
    sets,
  };

  const entry = (await exerciseEntryRepository.createExerciseEntry(
    userId,
    entryData,
    createdByUserId,
    ENTRY_SOURCE,
    presetEntryId
  )) as ExerciseEntryRow | null;

  try {
    await workoutPresetRepository.addExerciseToWorkoutPreset(
      userId,
      workoutPresetId,
      exercise.id,
      null,
      sets,
      exerciseIndex
    );
  } catch (error) {
    log(
      'warn',
      `[speedianceDataProcessor] Unable to update reusable preset for training ${record.trainingId}: ${errorMessage(error)}`
    );
  }

  if (entry?.id) {
    try {
      await activityDetailsRepository.createActivityDetail(userId, {
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
    } catch (error) {
      log(
        'warn',
        `[speedianceDataProcessor] Unable to store raw activity detail for entry ${entry.id}: ${errorMessage(error)}`
      );
    }
  }

  return entry;
}

async function processWorkout(
  userId: string,
  createdByUserId: string,
  bundle: SpeedianceWorkoutBundle,
  timezone: string
): Promise<number> {
  const { record } = bundle;
  const workoutPreset = await findOrCreateWorkoutPreset(userId, record.title);
  const entryDate = instantToDay(
    new Date(record.startTimestamp * 1000),
    timezone
  );
  const presetEntry =
    (await exercisePresetEntryRepository.createExercisePresetEntry(
      userId,
      {
        user_id: userId,
        workout_preset_id: workoutPreset.id,
        name: record.title,
        description: `Speediance workout type ${record.type}`,
        entry_date: entryDate,
        created_by_user_id: createdByUserId,
        notes: `Speediance training ID: ${record.trainingId}`,
        source: ENTRY_SOURCE,
      },
      createdByUserId
    )) as PresetEntryRow;

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

  let importedExercises = 0;
  for (let index = 0; index < exercises.length; index++) {
    const detail = exercises[index];
    if (!detail) continue;
    const entry = await createExerciseEntry(
      userId,
      createdByUserId,
      record,
      detail,
      index,
      presetEntry.id,
      workoutPreset.id,
      timezone
    );
    if (entry) importedExercises++;
  }

  if (bundle.exercises.length > 0 && importedExercises > 0) {
    await exercisePresetEntryRepository.deleteOnePlannedPresetEntry(
      userId,
      workoutPreset.id,
      entryDate
    );
  }
  return importedExercises;
}

export async function processSpeedianceWorkouts(
  userId: string,
  createdByUserId: string,
  bundles: SpeedianceWorkoutBundle[],
  startDate: string,
  endDate: string,
  timezone: string
): Promise<SpeedianceProcessingResult> {
  await exerciseEntryRepository.deleteExerciseEntriesByEntrySourceAndDate(
    userId,
    startDate,
    endDate,
    ENTRY_SOURCE
  );
  await exercisePresetEntryRepository.deleteExercisePresetEntriesByEntrySourceAndDate(
    userId,
    startDate,
    endDate,
    ENTRY_SOURCE
  );

  let importedWorkouts = 0;
  let importedExercises = 0;
  let skippedWorkouts = 0;
  const seenIds = new Set<string>();
  for (const bundle of bundles) {
    if (seenIds.has(bundle.record.trainingId)) continue;
    seenIds.add(bundle.record.trainingId);
    try {
      importedExercises += await processWorkout(
        userId,
        createdByUserId,
        bundle,
        timezone
      );
      importedWorkouts++;
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
