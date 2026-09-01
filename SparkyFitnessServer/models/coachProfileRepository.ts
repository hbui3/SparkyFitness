import type {
  CoachProfiles,
  ProactiveCoachCategory,
  UpdateCoachProfileRequest,
} from '@workspace/shared';
import { getClient, getSystemClient } from '../db/poolManager.js';
import {
  isProactiveCoachTopic,
  type ProactiveCoachOpportunity,
  type RecentProactiveCoachMessage,
} from '../types/proactiveCoach.js';

export type ScheduledProactiveCoachMessageKind =
  'adaptive' | 'daily' | 'weekly';
export type ProactiveCoachMessageKind =
  ScheduledProactiveCoachMessageKind | 'restock';

// Daily and weekly messages keep their independent scheduled cadence.
const ADAPTIVE_COOLDOWN_MESSAGE_KINDS: ProactiveCoachMessageKind[] = [
  'adaptive',
  'restock',
];

export interface ProactiveCoachCandidate {
  userId: string;
  timezone: string;
  language: string;
  adaptiveCheckInsEnabled: boolean;
  adaptiveLastObservedSlot: string | null;
  adaptiveStartTime: string;
  adaptiveEndTime: string;
  adaptiveIntervalMinutes: number;
  proactiveCategories: ProactiveCoachCategory[];
  adaptiveLastSignature: string | null;
  adaptiveCooldownLastMessageAt: string | null;
  lastUserMessageAt: string | null;
  coachingNotes: string | null;
  routines: string[];
  memoryEnabled: boolean;
  dailyCheckInEnabled: boolean;
  dailyCheckInTime: string;
  dailyLastSentOn: string | null;
  restockLastSentOn: string | null;
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
  adaptive_start_time,
  adaptive_end_time,
  adaptive_interval_minutes,
  proactive_categories,
  adaptive_last_signature,
  memory_enabled,
  auto_memory_enabled,
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
         adaptive_start_time,
         adaptive_end_time,
         adaptive_interval_minutes,
         proactive_categories,
         memory_enabled,
         auto_memory_enabled,
         daily_check_in_enabled,
         daily_check_in_time,
         weekly_review_enabled,
         weekly_review_day,
         weekly_review_time
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::time, $11::time, $12, $13, $14, $15, $16, $17::time, $18, $19, $20::time)
       ON CONFLICT (user_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         dietary_pattern = EXCLUDED.dietary_pattern,
         excluded_ingredients = EXCLUDED.excluded_ingredients,
         preferred_ingredients = EXCLUDED.preferred_ingredients,
         disliked_ingredients = EXCLUDED.disliked_ingredients,
         routines = EXCLUDED.routines,
         coaching_notes = EXCLUDED.coaching_notes,
         adaptive_check_ins_enabled = EXCLUDED.adaptive_check_ins_enabled,
         adaptive_start_time = EXCLUDED.adaptive_start_time,
         adaptive_end_time = EXCLUDED.adaptive_end_time,
         adaptive_interval_minutes = EXCLUDED.adaptive_interval_minutes,
         proactive_categories = EXCLUDED.proactive_categories,
         memory_enabled = EXCLUDED.memory_enabled,
         auto_memory_enabled = EXCLUDED.auto_memory_enabled,
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
        profile.adaptiveStartTime,
        profile.adaptiveEndTime,
        profile.adaptiveIntervalMinutes,
        profile.proactiveCategories,
        profile.memoryEnabled,
        profile.autoMemoryEnabled,
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
         cp.adaptive_start_time,
         cp.adaptive_end_time,
         cp.adaptive_interval_minutes,
         cp.proactive_categories,
         cp.adaptive_last_signature,
         cp.coaching_notes,
         cp.routines,
         cp.memory_enabled,
         (
           SELECT MAX(history.created_at)
           FROM sparky_chat_history history
           WHERE history.user_id = cp.user_id
             AND history.message_type = 'assistant'
             AND history.metadata->>'source' = 'proactive_coach'
             AND history.metadata->>'kind' = ANY($1::text[])
         ) AS adaptive_cooldown_last_message_at,
         (
           SELECT MAX(history.created_at)
           FROM sparky_chat_history history
           WHERE history.user_id = cp.user_id
             AND history.message_type = 'user'
         ) AS last_user_message_at,
         cp.daily_check_in_enabled,
         cp.daily_check_in_time,
         TO_CHAR(cp.daily_last_sent_on, 'YYYY-MM-DD') AS daily_last_sent_on,
         (
           SELECT history.metadata->>'localDate'
           FROM sparky_chat_history history
           WHERE history.user_id = cp.user_id
             AND history.message_type = 'assistant'
             AND history.metadata->>'source' = 'proactive_coach'
             AND history.metadata->>'kind' = 'restock'
           ORDER BY history.created_at DESC
           LIMIT 1
         ) AS restock_last_sent_on,
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
         )`,
      [ADAPTIVE_COOLDOWN_MESSAGE_KINDS]
    );
    return rows.map((row: Record<string, unknown>) => ({
      userId: String(row.user_id),
      timezone: String(row.timezone || 'UTC'),
      language: String(row.language || 'en'),
      adaptiveCheckInsEnabled: row.adaptive_check_ins_enabled === true,
      adaptiveLastObservedSlot:
        typeof row.adaptive_last_sent_slot === 'string'
          ? row.adaptive_last_sent_slot
          : null,
      adaptiveStartTime: String(row.adaptive_start_time ?? '07:00').slice(0, 5),
      adaptiveEndTime: String(row.adaptive_end_time ?? '20:00').slice(0, 5),
      adaptiveIntervalMinutes: Number(row.adaptive_interval_minutes ?? 120),
      proactiveCategories: Array.isArray(row.proactive_categories)
        ? (row.proactive_categories as ProactiveCoachCategory[])
        : ['nutrition', 'hydration', 'training', 'recovery'],
      adaptiveLastSignature:
        typeof row.adaptive_last_signature === 'string'
          ? row.adaptive_last_signature
          : null,
      adaptiveCooldownLastMessageAt: timestampString(
        row.adaptive_cooldown_last_message_at
      ),
      lastUserMessageAt: timestampString(row.last_user_message_at),
      coachingNotes:
        typeof row.coaching_notes === 'string' ? row.coaching_notes : null,
      routines: Array.isArray(row.routines)
        ? row.routines.filter(
            (value): value is string => typeof value === 'string'
          )
        : [],
      memoryEnabled: row.memory_enabled === true,
      dailyCheckInEnabled: row.daily_check_in_enabled === true,
      dailyCheckInTime: String(row.daily_check_in_time).slice(0, 5),
      dailyLastSentOn:
        typeof row.daily_last_sent_on === 'string'
          ? row.daily_last_sent_on
          : null,
      restockLastSentOn:
        typeof row.restock_last_sent_on === 'string'
          ? row.restock_last_sent_on
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

function timestampString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function listRecentProactiveMessages(
  userId: string,
  limit = 8
): Promise<RecentProactiveCoachMessage[]> {
  const client = await getClient(userId, userId);
  try {
    const { rows } = await client.query(
      `SELECT
         content,
         metadata->>'topic' AS topic,
         metadata->>'stateSignature' AS state_signature,
         created_at
       FROM sparky_chat_history
       WHERE user_id = $1
         AND message_type = 'assistant'
         AND metadata->>'source' = 'proactive_coach'
         AND metadata->>'kind' = ANY($3::text[])
       ORDER BY created_at DESC
       LIMIT $2`,
      [
        userId,
        Math.max(1, Math.min(20, Math.round(limit))),
        ADAPTIVE_COOLDOWN_MESSAGE_KINDS,
      ]
    );
    return rows.map((row: Record<string, unknown>) => ({
      content: String(row.content ?? ''),
      topic: isProactiveCoachTopic(row.topic) ? row.topic : null,
      stateSignature:
        typeof row.state_signature === 'string' ? row.state_signature : null,
      createdAt: timestampString(row.created_at) ?? new Date(0).toISOString(),
    }));
  } finally {
    client.release();
  }
}

async function getCoachLanguage(userId: string): Promise<string> {
  const client = await getClient(userId, userId);
  try {
    const { rows } = await client.query(
      `SELECT COALESCE(language, 'en') AS language
       FROM user_preferences
       WHERE user_id = $1`,
      [userId]
    );
    return String(rows[0]?.language || 'en');
  } finally {
    client.release();
  }
}

async function saveProactiveMessageIfDue(
  userId: string,
  kind: ProactiveCoachMessageKind,
  deliveryKey: string,
  content: string,
  stateSignature?: string,
  opportunity?: Pick<ProactiveCoachOpportunity, 'topic' | 'score' | 'tone'>
): Promise<boolean> {
  const client = await getClient(userId, userId);
  try {
    await client.query('BEGIN');
    if (kind === 'restock') {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`proactive-restock:${userId}:${deliveryKey}`]
      );
      const { rows } = (await client.query(
        `SELECT
           EXISTS (
             SELECT 1
             FROM coach_profiles profile
             WHERE profile.user_id = $1
               AND profile.enabled = TRUE
               AND 'nutrition' = ANY(profile.proactive_categories)
               AND (
                 profile.adaptive_check_ins_enabled = TRUE
                 OR profile.daily_check_in_enabled = TRUE
               )
           ) AS enabled,
           EXISTS (
             SELECT 1
             FROM sparky_chat_history history
             WHERE history.user_id = $1
               AND history.message_type = 'assistant'
               AND history.metadata->>'source' = 'proactive_coach'
               AND history.metadata->>'kind' = 'restock'
               AND history.metadata->>'deliveryKey' = $2
           ) AS already_delivered`,
        [userId, deliveryKey]
      )) as {
        rows: Array<{ enabled: boolean; already_delivered: boolean }>;
      };
      if (!rows[0]?.enabled || rows[0].already_delivered) {
        await client.query('ROLLBACK');
        return false;
      }
    } else {
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
      const claimed = await client.query(
        `UPDATE coach_profiles
         SET ${markerColumn} = ${markerValue},
             adaptive_last_signature = CASE
               WHEN $3::text IS NULL THEN adaptive_last_signature
               ELSE $3::text
             END
         WHERE user_id = $1
           AND enabled = TRUE
           AND ${enabledColumn} = TRUE
           AND ${markerColumn} IS DISTINCT FROM ${markerValue}
         RETURNING id`,
        [userId, deliveryKey, stateSignature ?? null]
      );
      if ((claimed.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return false;
      }
    }

    const metadata = {
      source: 'proactive_coach',
      kind,
      localDate: deliveryKey.slice(0, 10),
      deliveryKey,
      ...(stateSignature ? { stateSignature } : {}),
      ...(opportunity
        ? {
            topic: opportunity.topic,
            relevanceScore: opportunity.score,
            tone: opportunity.tone,
          }
        : {}),
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
    await client.query(
      `INSERT INTO coach_delivery_outbox (
         user_id,
         channel,
         telegram_chat_id,
         content,
         idempotency_key
       )
       SELECT $1, 'telegram', c.telegram_chat_id, $2, $3
       FROM coach_telegram_connections c
       WHERE c.user_id = $1
         AND c.enabled = TRUE
         AND c.telegram_chat_id IS NOT NULL
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [userId, content, `proactive:${userId}:${kind}:${deliveryKey}`]
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

async function markAdaptiveSlotObserved(
  userId: string,
  deliveryKey: string
): Promise<void> {
  const client = await getClient(userId, userId);
  try {
    await client.query(
      `UPDATE coach_profiles
       SET adaptive_last_sent_slot = $2,
           updated_at = now()
       WHERE user_id = $1
         AND enabled = TRUE
         AND adaptive_check_ins_enabled = TRUE
         AND adaptive_last_sent_slot IS DISTINCT FROM $2`,
      [userId, deliveryKey]
    );
  } finally {
    client.release();
  }
}

export default {
  getCoachProfile,
  upsertCoachProfile,
  listProactiveCoachCandidates,
  listRecentProactiveMessages,
  getCoachLanguage,
  saveProactiveMessageIfDue,
  markAdaptiveSlotObserved,
};
