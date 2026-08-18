import type {
  CoachProfiles,
  UpdateCoachProfileRequest,
} from '@workspace/shared';
import { getClient, getSystemClient } from '../db/poolManager.js';

export type ProactiveCoachMessageKind = 'adaptive' | 'daily' | 'weekly';

export interface ProactiveCoachCandidate {
  userId: string;
  timezone: string;
  language: string;
  adaptiveCheckInsEnabled: boolean;
  adaptiveLastSentSlot: string | null;
  dailyCheckInEnabled: boolean;
  dailyCheckInTime: string;
  dailyLastSentOn: string | null;
  weeklyReviewEnabled: boolean;
  weeklyReviewDay: number;
  weeklyReviewTime: string;
  weeklyLastSentOn: string | null;
}

const SELECT_COLUMNS = `
  id,
  user_id,
  enabled,
  dietary_pattern,
  excluded_ingredients,
  preferred_ingredients,
  disliked_ingredients,
  routines,
  coaching_notes,
  adaptive_check_ins_enabled,
  adaptive_last_sent_slot,
  daily_check_in_enabled,
  daily_check_in_time,
  weekly_review_enabled,
  weekly_review_day,
  weekly_review_time,
  daily_last_sent_on,
  weekly_last_sent_on,
  created_at,
  updated_at
`;

async function getCoachProfile(
  userId: string
): Promise<CoachProfiles | undefined> {
  const client = await getClient(userId, userId);
  try {
    const { rows } = await client.query(
      `SELECT ${SELECT_COLUMNS} FROM coach_profiles WHERE user_id = $1`,
      [userId]
    );
    return rows[0] as CoachProfiles | undefined;
  } finally {
    client.release();
  }
}

async function upsertCoachProfile(
  userId: string,
  profile: UpdateCoachProfileRequest
): Promise<CoachProfiles> {
  const client = await getClient(userId, userId);
  try {
    const { rows } = await client.query(
      `INSERT INTO coach_profiles (
         user_id,
         enabled,
         dietary_pattern,
         excluded_ingredients,
         preferred_ingredients,
         disliked_ingredients,
         routines,
         coaching_notes,
         adaptive_check_ins_enabled,
         daily_check_in_enabled,
         daily_check_in_time,
         weekly_review_enabled,
         weekly_review_day,
         weekly_review_time
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::time, $12, $13, $14::time)
       ON CONFLICT (user_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         dietary_pattern = EXCLUDED.dietary_pattern,
         excluded_ingredients = EXCLUDED.excluded_ingredients,
         preferred_ingredients = EXCLUDED.preferred_ingredients,
         disliked_ingredients = EXCLUDED.disliked_ingredients,
         routines = EXCLUDED.routines,
         coaching_notes = EXCLUDED.coaching_notes,
         adaptive_check_ins_enabled = EXCLUDED.adaptive_check_ins_enabled,
         daily_check_in_enabled = EXCLUDED.daily_check_in_enabled,
         daily_check_in_time = EXCLUDED.daily_check_in_time,
         weekly_review_enabled = EXCLUDED.weekly_review_enabled,
         weekly_review_day = EXCLUDED.weekly_review_day,
         weekly_review_time = EXCLUDED.weekly_review_time,
         updated_at = now()
       RETURNING ${SELECT_COLUMNS}`,
      [
        userId,
        profile.enabled,
        profile.dietaryPattern,
        profile.excludedIngredients,
        profile.preferredIngredients,
        profile.dislikedIngredients,
        profile.routines,
        profile.coachingNotes,
        profile.adaptiveCheckInsEnabled,
        profile.dailyCheckInEnabled,
        profile.dailyCheckInTime,
        profile.weeklyReviewEnabled,
        profile.weeklyReviewDay,
        profile.weeklyReviewTime,
      ]
    );
    return rows[0] as CoachProfiles;
  } finally {
    client.release();
  }
}

async function listProactiveCoachCandidates(): Promise<
  ProactiveCoachCandidate[]
> {
  const client = await getSystemClient();
  try {
    const { rows } = await client.query(
      `SELECT
         cp.user_id,
         COALESCE(up.timezone, 'UTC') AS timezone,
         COALESCE(up.language, 'en') AS language,
         cp.adaptive_check_ins_enabled,
         cp.adaptive_last_sent_slot,
         cp.daily_check_in_enabled,
         cp.daily_check_in_time,
         TO_CHAR(cp.daily_last_sent_on, 'YYYY-MM-DD') AS daily_last_sent_on,
         cp.weekly_review_enabled,
         cp.weekly_review_day,
         cp.weekly_review_time,
         TO_CHAR(cp.weekly_last_sent_on, 'YYYY-MM-DD') AS weekly_last_sent_on
       FROM coach_profiles cp
       LEFT JOIN user_preferences up ON up.user_id = cp.user_id
       WHERE cp.enabled = TRUE
         AND (
           cp.adaptive_check_ins_enabled = TRUE
           OR cp.daily_check_in_enabled = TRUE
           OR cp.weekly_review_enabled = TRUE
         )`
    );
    return rows.map((row: Record<string, unknown>) => ({
      userId: String(row.user_id),
      timezone: String(row.timezone || 'UTC'),
      language: String(row.language || 'en'),
      adaptiveCheckInsEnabled: row.adaptive_check_ins_enabled === true,
      adaptiveLastSentSlot:
        typeof row.adaptive_last_sent_slot === 'string'
          ? row.adaptive_last_sent_slot
          : null,
      dailyCheckInEnabled: row.daily_check_in_enabled === true,
      dailyCheckInTime: String(row.daily_check_in_time).slice(0, 5),
      dailyLastSentOn:
        typeof row.daily_last_sent_on === 'string'
          ? row.daily_last_sent_on
          : null,
      weeklyReviewEnabled: row.weekly_review_enabled === true,
      weeklyReviewDay: Number(row.weekly_review_day),
      weeklyReviewTime: String(row.weekly_review_time).slice(0, 5),
      weeklyLastSentOn:
        typeof row.weekly_last_sent_on === 'string'
          ? row.weekly_last_sent_on
          : null,
    }));
  } finally {
    client.release();
  }
}

async function saveProactiveMessageIfDue(
  userId: string,
  kind: ProactiveCoachMessageKind,
  deliveryKey: string,
  content: string
): Promise<boolean> {
  const client = await getClient(userId, userId);
  const markerColumn =
    kind === 'adaptive'
      ? 'adaptive_last_sent_slot'
      : kind === 'daily'
        ? 'daily_last_sent_on'
        : 'weekly_last_sent_on';
  const enabledColumn =
    kind === 'adaptive'
      ? 'adaptive_check_ins_enabled'
      : kind === 'daily'
        ? 'daily_check_in_enabled'
        : 'weekly_review_enabled';
  const markerValue = kind === 'adaptive' ? '$2' : '$2::date';
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      `UPDATE coach_profiles
       SET ${markerColumn} = ${markerValue}
       WHERE user_id = $1
         AND enabled = TRUE
         AND ${enabledColumn} = TRUE
         AND ${markerColumn} IS DISTINCT FROM ${markerValue}
       RETURNING id`,
      [userId, deliveryKey]
    );
    if ((claimed.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    const metadata = {
      source: 'proactive_coach',
      kind,
      localDate: deliveryKey.slice(0, 10),
      deliveryKey,
    };
    await client.query(
      `INSERT INTO sparky_chat_history
         (user_id, content, message_type, metadata, parts, created_at)
       VALUES ($1, $2, 'assistant', $3::jsonb, $4::jsonb, now())`,
      [
        userId,
        content,
        JSON.stringify(metadata),
        JSON.stringify([{ type: 'text', text: content }]),
      ]
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export default {
  getCoachProfile,
  upsertCoachProfile,
  listProactiveCoachCandidates,
  saveProactiveMessageIfDue,
};
