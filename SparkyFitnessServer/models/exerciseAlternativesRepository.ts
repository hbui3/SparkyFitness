import { getClient } from '../db/poolManager.js';
import { parseJsonArrayField } from '../utils/exerciseJsonFields.js';

/**
 * Reads backing exercise alternatives and workout variation (issue #1560).
 * Visibility is left entirely to RLS: whatever the caller could find in a
 * library search is a valid candidate.
 */

export interface AlternativeExerciseRow {
  id: string;
  name: string;
  source: string | null;
  source_id: string | null;
  category: string | null;
  modality: string;
  level: string | null;
  mechanic: string | null;
  force: string | null;
  equipment: string[];
  primary_muscles: string[];
  secondary_muscles: string[];
  images: string[];
  instructions: string[];
  description: string | null;
  calories_per_hour: number | null;
}

interface RawAlternativeExerciseRow {
  id: string;
  name: string;
  source: string | null;
  source_id: string | null;
  category: string | null;
  modality: string;
  level: string | null;
  mechanic: string | null;
  force: string | null;
  equipment: string | null;
  primary_muscles: string | null;
  secondary_muscles: string | null;
  images: string | null;
  instructions: string | null;
  description: string | null;
  calories_per_hour: number | null;
}

function toStringArray(value: string | null, context: string): string[] {
  return parseJsonArrayField(value, context).filter(
    (item): item is string => typeof item === 'string'
  );
}

function mapRow(row: RawAlternativeExerciseRow): AlternativeExerciseRow {
  return {
    ...row,
    equipment: toStringArray(row.equipment, `alternatives ${row.id} equipment`),
    primary_muscles: toStringArray(
      row.primary_muscles,
      `alternatives ${row.id} primary_muscles`
    ),
    secondary_muscles: toStringArray(
      row.secondary_muscles,
      `alternatives ${row.id} secondary_muscles`
    ),
    images: toStringArray(row.images, `alternatives ${row.id} images`),
    instructions: toStringArray(
      row.instructions,
      `alternatives ${row.id} instructions`
    ),
  };
}

const COLUMNS = `id, name, source, source_id, category, modality, level, mechanic,
  force, equipment, primary_muscles, secondary_muscles, images, instructions,
  description, calories_per_hour`;

export async function getAlternativeSourceExercise(
  userId: string,
  authenticatedUserId: string,
  exerciseId: string
): Promise<AlternativeExerciseRow | null> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `SELECT ${COLUMNS} FROM exercises WHERE id = $1`,
      [exerciseId]
    );
    const row = result.rows[0] as RawAlternativeExerciseRow | undefined;
    return row ? mapRow(row) : null;
  } finally {
    client.release();
  }
}

/**
 * Visible library exercises whose primary muscles include any of
 * `muscleSpellings` (lowercased). The case-insensitive element match catches
 * "Chest" and "chest" alike; synonyms are expanded by the caller.
 */
export async function getAlternativeLibraryCandidates(
  userId: string,
  authenticatedUserId: string,
  muscleSpellings: string[]
): Promise<AlternativeExerciseRow[]> {
  if (muscleSpellings.length === 0) return [];
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `SELECT ${COLUMNS}
         FROM exercises
        WHERE is_quick_exercise = FALSE
          AND primary_muscles IS NOT NULL
          AND primary_muscles LIKE '[%'
          AND EXISTS (
            SELECT 1
              FROM jsonb_array_elements_text(primary_muscles::jsonb) AS m(name)
             WHERE lower(trim(m.name)) = ANY($1::text[])
          )
        LIMIT 2000`,
      [muscleSpellings]
    );
    return (result.rows as RawAlternativeExerciseRow[]).map(mapRow);
  } finally {
    client.release();
  }
}

export interface ExerciseUsage {
  exerciseId: string;
  sessionCount: number;
  lastPerformedDate: string;
}

/**
 * Days with a logged entry per exercise between `sinceDay` and `untilDay`
 * (inclusive, YYYY-MM-DD). The upper bound matters: weekly plans pre-create
 * diary entries up to a year ahead, and those are not performances.
 */
export async function getRecentExerciseUsage(
  userId: string,
  authenticatedUserId: string,
  sinceDay: string,
  untilDay: string
): Promise<ExerciseUsage[]> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `SELECT exercise_id,
              COUNT(DISTINCT entry_date) AS session_count,
              MAX(entry_date) AS last_performed_date
         FROM exercise_entries
        WHERE user_id = $1
          AND exercise_id IS NOT NULL
          AND entry_date >= $2::date
          AND entry_date <= $3::date
        GROUP BY exercise_id`,
      [userId, sinceDay, untilDay]
    );
    const rows = result.rows as {
      exercise_id: string;
      session_count: number | string;
      last_performed_date: string;
    }[];
    return rows.map((row) => ({
      exerciseId: row.exercise_id,
      sessionCount: Number(row.session_count),
      lastPerformedDate: row.last_performed_date,
    }));
  } finally {
    client.release();
  }
}

/**
 * Whether the user has an active Free Exercise DB provider. The catalog is
 * only offered to users who have not switched that provider off, matching
 * what exercise search shows them.
 */
export async function hasActiveFreeExerciseDbProvider(
  userId: string,
  authenticatedUserId: string
): Promise<boolean> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `SELECT 1
         FROM external_data_providers
        WHERE user_id = $1
          AND provider_type = 'free-exercise-db'
          AND is_active = TRUE
        LIMIT 1`,
      [userId]
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}
