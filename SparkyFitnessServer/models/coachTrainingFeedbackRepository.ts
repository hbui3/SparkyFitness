import type {
  CoachTrainingPreference,
  CoachTrainingPreferenceSource,
  CoachWorkoutFeedback,
  RecordTrainingFeedbackRequest,
  TrainingPreferenceInput,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';

interface RecordFeedbackInput extends RecordTrainingFeedbackRequest {
  workoutDate: string;
}

async function recordFeedbackWithPreferences(
  userId: string,
  input: RecordFeedbackInput
): Promise<{
  feedback: CoachWorkoutFeedback;
  preferences: CoachTrainingPreference[];
}> {
  const client = await getClient(userId, userId);
  try {
    await client.query('BEGIN');
    const feedbackResult = await client.query(
      `INSERT INTO coach_workout_feedback (
         user_id, workout_date, workout_name, provider, overall_rating,
         difficulty, energy_rating, pain_level, notes, exercise_feedback
       ) VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       RETURNING id, user_id, workout_date, workout_name, provider,
                 overall_rating, difficulty, energy_rating, pain_level, notes,
                 exercise_feedback, created_at, updated_at`,
      [
        userId,
        input.workoutDate,
        input.workoutName.trim(),
        input.provider,
        input.overallRating ?? null,
        input.difficulty ?? null,
        input.energyRating ?? null,
        input.painLevel ?? null,
        input.notes?.trim() ?? null,
        JSON.stringify(input.exerciseFeedback),
      ]
    );
    const feedback = feedbackResult.rows[0] as CoachWorkoutFeedback;
    const preferences: CoachTrainingPreference[] = [];
    for (const preference of input.preferenceUpdates) {
      const result = await client.query(
        `INSERT INTO coach_training_preferences (
           user_id, kind, subject, sentiment, notes, source,
           source_feedback_id, active
         ) VALUES ($1, $2, $3, $4, $5, 'feedback', $6::uuid, TRUE)
         ON CONFLICT (user_id, kind, lower(subject)) DO UPDATE SET
           subject = EXCLUDED.subject,
           sentiment = EXCLUDED.sentiment,
           notes = EXCLUDED.notes,
           source = EXCLUDED.source,
           source_feedback_id = EXCLUDED.source_feedback_id,
           active = TRUE,
           updated_at = now()
         RETURNING id, user_id, kind, subject, sentiment, notes, source,
                   source_feedback_id, active, created_at, updated_at`,
        [
          userId,
          preference.kind,
          preference.subject.trim(),
          preference.sentiment,
          preference.notes?.trim() ?? null,
          feedback.id,
        ]
      );
      preferences.push(result.rows[0] as CoachTrainingPreference);
    }
    await client.query('COMMIT');
    return { feedback, preferences };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function upsertPreference(
  userId: string,
  input: TrainingPreferenceInput,
  source: CoachTrainingPreferenceSource
): Promise<CoachTrainingPreference> {
  const client = await getClient(userId, userId);
  try {
    const result = await client.query(
      `INSERT INTO coach_training_preferences (
         user_id, kind, subject, sentiment, notes, source, active
       ) VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       ON CONFLICT (user_id, kind, lower(subject)) DO UPDATE SET
         subject = EXCLUDED.subject,
         sentiment = EXCLUDED.sentiment,
         notes = EXCLUDED.notes,
         source = EXCLUDED.source,
         source_feedback_id = NULL,
         active = TRUE,
         updated_at = now()
       RETURNING id, user_id, kind, subject, sentiment, notes, source,
                 source_feedback_id, active, created_at, updated_at`,
      [
        userId,
        input.kind,
        input.subject.trim(),
        input.sentiment,
        input.notes?.trim() ?? null,
        source,
      ]
    );
    return result.rows[0] as CoachTrainingPreference;
  } finally {
    client.release();
  }
}

async function deactivatePreference(
  userId: string,
  preferenceId: string
): Promise<boolean> {
  const client = await getClient(userId, userId);
  try {
    const result = await client.query(
      `UPDATE coach_training_preferences
       SET active = FALSE, updated_at = now()
       WHERE id = $1::uuid AND user_id = $2 AND active = TRUE`,
      [preferenceId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

async function listActivePreferences(
  userId: string
): Promise<CoachTrainingPreference[]> {
  const client = await getClient(userId, userId);
  try {
    const result = await client.query(
      `SELECT id, user_id, kind, subject, sentiment, notes, source,
              source_feedback_id, active, created_at, updated_at
       FROM coach_training_preferences
       WHERE user_id = $1 AND active = TRUE
       ORDER BY updated_at DESC, id`,
      [userId]
    );
    return result.rows as CoachTrainingPreference[];
  } finally {
    client.release();
  }
}

async function listRecentFeedback(
  userId: string,
  limit = 12
): Promise<CoachWorkoutFeedback[]> {
  const client = await getClient(userId, userId);
  try {
    const result = await client.query(
      `SELECT id, user_id, workout_date, workout_name, provider,
              overall_rating, difficulty, energy_rating, pain_level, notes,
              exercise_feedback, created_at, updated_at
       FROM coach_workout_feedback
       WHERE user_id = $1
       ORDER BY workout_date DESC, created_at DESC
       LIMIT $2`,
      [userId, Math.max(1, Math.min(50, limit))]
    );
    return result.rows as CoachWorkoutFeedback[];
  } finally {
    client.release();
  }
}

export default {
  recordFeedbackWithPreferences,
  upsertPreference,
  deactivatePreference,
  listActivePreferences,
  listRecentFeedback,
};
