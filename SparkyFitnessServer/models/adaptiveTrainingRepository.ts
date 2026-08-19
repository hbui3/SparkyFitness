import type {
  AdaptiveTrainingReason,
  AdaptiveTrainingSettingsResponse,
  UpdateAdaptiveTrainingRecommendationStatusRequest,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';

export interface AdaptiveTrainingSettingsRow {
  user_id: string;
  enabled: boolean;
  sessions_per_week: number;
  max_duration_minutes: number;
  recovery_window_hours: number;
  preferred_muscles: string[];
  candidate_workout_preset_ids: number[];
  avoid_consecutive_training_days: boolean;
}

export interface AdaptiveTrainingRecommendationRow {
  id: string;
  recommendation_date: string;
  kind: 'workout' | 'recovery';
  workout_preset_id: number | null;
  status: 'planned' | 'accepted' | 'skipped' | 'completed';
  score: number;
  volume_factor: number;
  muscle_load_snapshot: Record<string, unknown>;
  workout_snapshot: Record<string, unknown> | null;
  rationale: AdaptiveTrainingReason[];
  algorithm_version: string;
  generated_at: Date | string;
}

export interface AdaptiveTrainingPresetRow {
  preset_id: number;
  preset_name: string;
  preset_description: string | null;
  preset_exercise_id: number | null;
  exercise_name: string | null;
  primary_muscles: string | null;
  secondary_muscles: string | null;
  sets: Array<{
    reps: number | null;
    weight: number | null;
    duration: number | null;
    rest_time: number | null;
  }>;
}

export interface AdaptiveTrainingReadinessRow {
  sleep_hours: number | null;
  sleep_score: number | null;
  training_readiness_score: number | null;
}

async function getSettings(
  userId: string,
  authenticatedUserId: string
): Promise<AdaptiveTrainingSettingsRow | null> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `SELECT user_id, enabled, sessions_per_week, max_duration_minutes,
              recovery_window_hours, preferred_muscles,
              candidate_workout_preset_ids, avoid_consecutive_training_days
       FROM adaptive_training_settings
       WHERE user_id = $1`,
      [userId]
    );
    return (result.rows as AdaptiveTrainingSettingsRow[])[0] ?? null;
  } finally {
    client.release();
  }
}

async function upsertSettings(
  userId: string,
  authenticatedUserId: string,
  settings: AdaptiveTrainingSettingsResponse
): Promise<AdaptiveTrainingSettingsRow> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `INSERT INTO adaptive_training_settings (
         user_id, enabled, sessions_per_week, max_duration_minutes,
         recovery_window_hours, preferred_muscles,
         candidate_workout_preset_ids, avoid_consecutive_training_days
       ) VALUES ($1, $2, $3, $4, $5, $6::text[], $7::integer[], $8)
       ON CONFLICT (user_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         sessions_per_week = EXCLUDED.sessions_per_week,
         max_duration_minutes = EXCLUDED.max_duration_minutes,
         recovery_window_hours = EXCLUDED.recovery_window_hours,
         preferred_muscles = EXCLUDED.preferred_muscles,
         candidate_workout_preset_ids = EXCLUDED.candidate_workout_preset_ids,
         avoid_consecutive_training_days = EXCLUDED.avoid_consecutive_training_days
       RETURNING user_id, enabled, sessions_per_week, max_duration_minutes,
                 recovery_window_hours, preferred_muscles,
                 candidate_workout_preset_ids,
                 avoid_consecutive_training_days`,
      [
        userId,
        settings.enabled,
        settings.sessionsPerWeek,
        settings.maxDurationMinutes,
        settings.recoveryWindowHours,
        settings.preferredMuscles,
        settings.candidateWorkoutPresetIds,
        settings.avoidConsecutiveTrainingDays,
      ]
    );
    return (result.rows as AdaptiveTrainingSettingsRow[])[0];
  } finally {
    client.release();
  }
}

async function getPresetRows(
  userId: string,
  authenticatedUserId: string
): Promise<AdaptiveTrainingPresetRow[]> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `SELECT wp.id AS preset_id,
              wp.name AS preset_name,
              wp.description AS preset_description,
              wpe.id AS preset_exercise_id,
              e.name AS exercise_name,
              e.primary_muscles,
              e.secondary_muscles,
              COALESCE(
                json_agg(
                  json_build_object(
                    'reps', wpes.reps,
                    'weight', wpes.weight,
                    'duration', wpes.duration,
                    'rest_time', wpes.rest_time
                  ) ORDER BY wpes.set_number
                ) FILTER (WHERE wpes.id IS NOT NULL),
                '[]'::json
              ) AS sets
       FROM workout_presets wp
       LEFT JOIN workout_preset_exercises wpe
         ON wpe.workout_preset_id = wp.id
       LEFT JOIN exercises e ON e.id = wpe.exercise_id
       LEFT JOIN workout_preset_exercise_sets wpes
         ON wpes.workout_preset_exercise_id = wpe.id
       WHERE wp.user_id = $1
       GROUP BY wp.id, wp.name, wp.description, wpe.id, wpe.sort_order,
                e.name, e.primary_muscles, e.secondary_muscles
       ORDER BY wp.name, wp.id, wpe.sort_order NULLS LAST, wpe.id`,
      [userId]
    );
    return result.rows as AdaptiveTrainingPresetRow[];
  } finally {
    client.release();
  }
}

async function getReadiness(
  userId: string,
  authenticatedUserId: string,
  date: string
): Promise<AdaptiveTrainingReadinessRow> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `SELECT
         (SELECT duration_in_seconds::numeric / 3600
            FROM sleep_entries
           WHERE user_id = $1
             AND entry_date BETWEEN $2::date - 1 AND $2::date
           ORDER BY entry_date DESC, updated_at DESC NULLS LAST
           LIMIT 1) AS sleep_hours,
         (SELECT sleep_score::numeric
            FROM sleep_entries
           WHERE user_id = $1
             AND entry_date BETWEEN $2::date - 1 AND $2::date
           ORDER BY entry_date DESC, updated_at DESC NULLS LAST
           LIMIT 1) AS sleep_score,
         (SELECT training_readiness_score::numeric
            FROM daily_health_metrics
           WHERE user_id = $1 AND entry_date = $2::date
           ORDER BY entry_date DESC, updated_at DESC NULLS LAST
           LIMIT 1) AS training_readiness_score`,
      [userId, date]
    );
    return (
      (result.rows as AdaptiveTrainingReadinessRow[])[0] ?? {
        sleep_hours: null,
        sleep_score: null,
        training_readiness_score: null,
      }
    );
  } finally {
    client.release();
  }
}

async function getRecommendation(
  userId: string,
  authenticatedUserId: string,
  date: string
): Promise<AdaptiveTrainingRecommendationRow | null> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `SELECT id, recommendation_date, kind, workout_preset_id, status,
              score::numeric, volume_factor::numeric, muscle_load_snapshot,
              workout_snapshot, rationale, algorithm_version, generated_at
       FROM adaptive_training_recommendations
       WHERE user_id = $1 AND recommendation_date = $2::date`,
      [userId, date]
    );
    return (result.rows as AdaptiveTrainingRecommendationRow[])[0] ?? null;
  } finally {
    client.release();
  }
}

interface SaveRecommendationInput {
  date: string;
  kind: 'workout' | 'recovery';
  workoutPresetId: number | null;
  score: number;
  volumeFactor: number;
  muscleLoadSnapshot: Record<string, unknown>;
  workoutSnapshot: Record<string, unknown> | null;
  rationale: AdaptiveTrainingReason[];
  settingsSnapshot: AdaptiveTrainingSettingsResponse;
  algorithmVersion: string;
}

async function saveRecommendation(
  userId: string,
  authenticatedUserId: string,
  input: SaveRecommendationInput
): Promise<AdaptiveTrainingRecommendationRow> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `INSERT INTO adaptive_training_recommendations (
         user_id, recommendation_date, kind, workout_preset_id, status,
         score, volume_factor, muscle_load_snapshot, workout_snapshot,
         rationale, settings_snapshot, algorithm_version, generated_at
       ) VALUES (
         $1, $2::date, $3, $4, 'planned', $5, $6, $7::jsonb, $8::jsonb,
         $9::jsonb, $10::jsonb, $11, now()
       )
       ON CONFLICT (user_id, recommendation_date) DO UPDATE SET
         kind = EXCLUDED.kind,
         workout_preset_id = EXCLUDED.workout_preset_id,
         status = 'planned',
         score = EXCLUDED.score,
         volume_factor = EXCLUDED.volume_factor,
         muscle_load_snapshot = EXCLUDED.muscle_load_snapshot,
         workout_snapshot = EXCLUDED.workout_snapshot,
         rationale = EXCLUDED.rationale,
         settings_snapshot = EXCLUDED.settings_snapshot,
         algorithm_version = EXCLUDED.algorithm_version,
         generated_at = now()
       RETURNING id, recommendation_date, kind, workout_preset_id, status,
                 score::numeric, volume_factor::numeric, muscle_load_snapshot,
                 workout_snapshot, rationale, algorithm_version, generated_at`,
      [
        userId,
        input.date,
        input.kind,
        input.workoutPresetId,
        input.score,
        input.volumeFactor,
        JSON.stringify(input.muscleLoadSnapshot),
        input.workoutSnapshot === null
          ? null
          : JSON.stringify(input.workoutSnapshot),
        JSON.stringify(input.rationale),
        JSON.stringify(input.settingsSnapshot),
        input.algorithmVersion,
      ]
    );
    return (result.rows as AdaptiveTrainingRecommendationRow[])[0];
  } finally {
    client.release();
  }
}

async function updateRecommendationStatus(
  userId: string,
  authenticatedUserId: string,
  date: string,
  status: UpdateAdaptiveTrainingRecommendationStatusRequest['status']
): Promise<AdaptiveTrainingRecommendationRow | null> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `UPDATE adaptive_training_recommendations
       SET status = $3
       WHERE user_id = $1 AND recommendation_date = $2::date
       RETURNING id, recommendation_date, kind, workout_preset_id, status,
                 score::numeric, volume_factor::numeric, muscle_load_snapshot,
                 workout_snapshot, rationale, algorithm_version, generated_at`,
      [userId, date, status]
    );
    return (result.rows as AdaptiveTrainingRecommendationRow[])[0] ?? null;
  } finally {
    client.release();
  }
}

export default {
  getSettings,
  upsertSettings,
  getPresetRows,
  getReadiness,
  getRecommendation,
  saveRecommendation,
  updateRecommendationStatus,
};
