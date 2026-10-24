import type {
  WorkoutCoachingSettings,
  WorkoutFeedbackDifficulty,
  WorkoutSessionFeedbackResponse,
} from '@workspace/shared';
import {
  getAdaptiveSuggestionsSetting,
  getExerciseEntrySessionId,
  getSessionFeedbackRows,
  getSessionOwnership,
  replaceSessionFeedback,
  setAdaptiveSuggestionsSetting,
  type FeedbackValues,
  type StoredFeedbackRow,
} from '../models/workoutFeedbackRepository.js';

/**
 * Session feedback and the adaptive-suggestions setting (issue #1560).
 * Adaptive prescription itself lives in services/adaptiveWorkoutService.ts.
 */

export class WorkoutSessionNotFoundError extends Error {
  constructor() {
    super('Workout session not found');
    this.name = 'WorkoutSessionNotFoundError';
  }
}

export class WorkoutFeedbackValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkoutFeedbackValidationError';
  }
}

interface ParsedFeedback {
  difficulty: WorkoutFeedbackDifficulty | null;
  pain: boolean;
  pain_note?: string | null;
}

interface ParsedSessionFeedbackRequest {
  session: ParsedFeedback | null;
  exercises: (ParsedFeedback & { exercise_entry_id: string })[];
}

function toValues(input: ParsedFeedback): FeedbackValues {
  return {
    difficulty: input.difficulty,
    pain: input.pain,
    painNote: input.pain ? (input.pain_note ?? null) : null,
  };
}

function toResponse(
  presetEntryId: string,
  rows: StoredFeedbackRow[]
): WorkoutSessionFeedbackResponse {
  const sessionRow = rows.find(
    (row) =>
      row.exercise_preset_entry_id !== null &&
      row.exercise_preset_entry_id !== undefined
  );
  return {
    exercise_preset_entry_id: presetEntryId,
    session: sessionRow
      ? {
          difficulty: sessionRow.difficulty,
          pain: sessionRow.pain,
          pain_note: sessionRow.pain_note,
          updated_at: new Date(sessionRow.updated_at).toISOString(),
        }
      : null,
    exercises: rows
      .filter(
        (row) =>
          row.exercise_entry_id !== null && row.exercise_entry_id !== undefined
      )
      .map((row) => ({
        exercise_entry_id: row.exercise_entry_id as string,
        difficulty: row.difficulty,
        pain: row.pain,
        pain_note: row.pain_note,
        updated_at: new Date(row.updated_at).toISOString(),
      })),
  };
}

export async function getWorkoutSessionFeedback(
  userId: string,
  authenticatedUserId: string,
  presetEntryId: string
): Promise<WorkoutSessionFeedbackResponse> {
  const ownership = await getSessionOwnership(
    userId,
    authenticatedUserId,
    presetEntryId
  );
  if (!ownership) throw new WorkoutSessionNotFoundError();
  const rows = await getSessionFeedbackRows(
    ownership.userId,
    authenticatedUserId,
    presetEntryId
  );
  return toResponse(presetEntryId, rows);
}

export async function updateWorkoutSessionFeedback(
  userId: string,
  authenticatedUserId: string,
  presetEntryId: string,
  request: ParsedSessionFeedbackRequest
): Promise<WorkoutSessionFeedbackResponse> {
  const ownership = await getSessionOwnership(
    userId,
    authenticatedUserId,
    presetEntryId
  );
  if (!ownership) throw new WorkoutSessionNotFoundError();

  const sessionEntryIds = new Set(ownership.exerciseEntryIds);
  const foreign = request.exercises.filter(
    (exercise) => !sessionEntryIds.has(exercise.exercise_entry_id)
  );
  if (foreign.length > 0) {
    throw new WorkoutFeedbackValidationError(
      `Exercise entries not in this session: ${foreign
        .map((exercise) => exercise.exercise_entry_id)
        .join(', ')}`
    );
  }

  await replaceSessionFeedback(
    ownership.userId,
    authenticatedUserId,
    presetEntryId,
    request.session ? toValues(request.session) : null,
    new Map(
      request.exercises.map((exercise) => [
        exercise.exercise_entry_id,
        toValues(exercise),
      ])
    ),
    ownership.exerciseEntryIds
  );

  const rows = await getSessionFeedbackRows(
    ownership.userId,
    authenticatedUserId,
    presetEntryId
  );
  return toResponse(presetEntryId, rows);
}

export async function getWorkoutCoachingSettings(
  userId: string,
  authenticatedUserId: string
): Promise<WorkoutCoachingSettings> {
  return {
    adaptive_suggestions: await getAdaptiveSuggestionsSetting(
      userId,
      authenticatedUserId
    ),
  };
}

export async function updateWorkoutCoachingSettings(
  userId: string,
  settings: WorkoutCoachingSettings
): Promise<WorkoutCoachingSettings> {
  return {
    adaptive_suggestions: await setAdaptiveSuggestionsSetting(
      userId,
      settings.adaptive_suggestions
    ),
  };
}

export class WorkoutEntryNotInSessionError extends Error {
  constructor() {
    super('This exercise entry is not part of a logged workout session');
    this.name = 'WorkoutEntryNotInSessionError';
  }
}

/**
 * Set one piece of feedback — for the whole session an exercise entry
 * belongs to, or for that exercise alone — keeping everything else already
 * recorded for the session. Used by the AI assistant, which addresses
 * workouts through the exercise entry ids the diary listing shows.
 */
/**
 * A partial answer from the assistant: omitted fields keep what is already
 * recorded, `difficulty: null` clears it, and `pain: false` clears pain and
 * its note. A note on its own implies pain.
 */
export interface PartialFeedback {
  difficulty?: WorkoutFeedbackDifficulty | null;
  pain?: boolean;
  pain_note?: string | null;
}

function mergeFeedback(
  existing: ParsedFeedback | null | undefined,
  change: PartialFeedback
): ParsedFeedback {
  const pain =
    change.pain ?? (change.pain_note ? true : (existing?.pain ?? false));
  return {
    difficulty:
      change.difficulty !== undefined
        ? change.difficulty
        : (existing?.difficulty ?? null),
    pain,
    pain_note: pain
      ? change.pain_note !== undefined
        ? change.pain_note
        : (existing?.pain_note ?? null)
      : null,
  };
}

export async function setWorkoutFeedbackForEntry(
  userId: string,
  authenticatedUserId: string,
  exerciseEntryId: string,
  scope: 'session' | 'exercise',
  change: PartialFeedback
): Promise<WorkoutSessionFeedbackResponse> {
  const entry = await getExerciseEntrySessionId(
    userId,
    authenticatedUserId,
    exerciseEntryId
  );
  if (!entry.found) throw new WorkoutSessionNotFoundError();
  if (!entry.presetEntryId) throw new WorkoutEntryNotInSessionError();
  const current = await getWorkoutSessionFeedback(
    userId,
    authenticatedUserId,
    entry.presetEntryId
  );
  const existingExercise = current.exercises.find(
    (exercise) => exercise.exercise_entry_id === exerciseEntryId
  );
  const feedback = mergeFeedback(
    scope === 'session' ? current.session : existingExercise,
    change
  );
  const keepExercise = current.exercises.filter(
    (exercise) =>
      scope === 'session' || exercise.exercise_entry_id !== exerciseEntryId
  );
  return updateWorkoutSessionFeedback(
    userId,
    authenticatedUserId,
    entry.presetEntryId,
    {
      session:
        scope === 'session'
          ? feedback
          : current.session
            ? {
                difficulty: current.session.difficulty,
                pain: current.session.pain,
                pain_note: current.session.pain_note,
              }
            : null,
      exercises: [
        ...keepExercise.map((exercise) => ({
          exercise_entry_id: exercise.exercise_entry_id,
          difficulty: exercise.difficulty,
          pain: exercise.pain,
          pain_note: exercise.pain_note,
        })),
        ...(scope === 'exercise'
          ? [{ exercise_entry_id: exerciseEntryId, ...feedback }]
          : []),
      ],
    }
  );
}
