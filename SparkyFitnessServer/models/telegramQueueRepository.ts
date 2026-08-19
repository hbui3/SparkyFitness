import { getSystemClient } from '../db/poolManager.js';
import type { TelegramUpdate } from '../services/telegramCoachService.js';

export interface TelegramInboxWorkItem {
  updateId: number;
  payload: TelegramUpdate;
  attemptCount: number;
}

export interface TelegramButton {
  text: string;
  callback_data: string;
}

export interface TelegramOutboxWorkItem {
  id: string;
  userId: string;
  telegramChatId: string | null;
  content: string;
  buttons: TelegramButton[][];
  attemptCount: number;
}

async function enqueueUpdate(update: TelegramUpdate): Promise<boolean> {
  if (!Number.isSafeInteger(update.update_id)) return false;
  const client = await getSystemClient();
  try {
    const result = await client.query(
      `INSERT INTO telegram_update_inbox (update_id, payload)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (update_id) DO NOTHING`,
      [update.update_id, JSON.stringify(update)]
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

async function claimNextUpdate(): Promise<TelegramInboxWorkItem | null> {
  const client = await getSystemClient();
  try {
    const { rows } = await client.query(
      `WITH candidate AS (
         SELECT update_id
         FROM telegram_update_inbox
         WHERE (
           status = 'pending'
           OR (status = 'processing' AND locked_at < now() - interval '5 minutes')
         )
           AND available_at <= now()
         ORDER BY update_id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE telegram_update_inbox i
       SET status = 'processing',
           attempt_count = i.attempt_count + 1,
           locked_at = now(),
           last_error = NULL
       FROM candidate c
       WHERE i.update_id = c.update_id
       RETURNING i.update_id, i.payload, i.attempt_count`
    );
    if (!rows[0]) return null;
    return {
      updateId: Number(rows[0].update_id),
      payload: rows[0].payload as TelegramUpdate,
      attemptCount: Number(rows[0].attempt_count),
    };
  } finally {
    client.release();
  }
}

async function completeUpdate(updateId: number): Promise<void> {
  const client = await getSystemClient();
  try {
    await client.query(
      `UPDATE telegram_update_inbox
       SET status = 'processed', processed_at = now(), locked_at = NULL
       WHERE update_id = $1`,
      [updateId]
    );
  } finally {
    client.release();
  }
}

async function retryUpdate(
  updateId: number,
  attemptCount: number,
  errorCode: string
): Promise<void> {
  const client = await getSystemClient();
  const dead = attemptCount >= 8;
  const delaySeconds = Math.min(900, 2 ** Math.min(attemptCount, 9));
  try {
    await client.query(
      `UPDATE telegram_update_inbox
       SET status = $2,
           available_at = now() + ($3::int * interval '1 second'),
           locked_at = NULL,
           last_error = $4
       WHERE update_id = $1`,
      [
        updateId,
        dead ? 'dead_letter' : 'pending',
        delaySeconds,
        errorCode.slice(0, 200),
      ]
    );
  } finally {
    client.release();
  }
}

async function enqueueDelivery(input: {
  userId: string;
  telegramChatId?: string | null;
  content: string;
  buttons?: TelegramButton[][];
  idempotencyKey: string;
}): Promise<string | null> {
  const client = await getSystemClient();
  try {
    const { rows } = await client.query(
      `INSERT INTO coach_delivery_outbox
         (user_id, telegram_chat_id, content, buttons, idempotency_key)
       VALUES ($1, $2::bigint, $3, $4::jsonb, $5)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        input.userId,
        input.telegramChatId ?? null,
        input.content,
        JSON.stringify(input.buttons ?? []),
        input.idempotencyKey,
      ]
    );
    return rows[0]?.id ? String(rows[0].id) : null;
  } finally {
    client.release();
  }
}

async function claimNextDelivery(): Promise<TelegramOutboxWorkItem | null> {
  const client = await getSystemClient();
  try {
    const { rows } = await client.query(
      `WITH candidate AS (
         SELECT id
         FROM coach_delivery_outbox
         WHERE (
           status = 'pending'
           OR (status = 'processing' AND locked_at < now() - interval '5 minutes')
         )
           AND available_at <= now()
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE coach_delivery_outbox o
       SET status = 'processing',
           attempt_count = o.attempt_count + 1,
           locked_at = now(),
           last_error = NULL
       FROM candidate c
       WHERE o.id = c.id
       RETURNING o.id, o.user_id, o.telegram_chat_id::text, o.content,
                 o.buttons, o.attempt_count`
    );
    if (!rows[0]) return null;
    return {
      id: String(rows[0].id),
      userId: String(rows[0].user_id),
      telegramChatId: rows[0].telegram_chat_id
        ? String(rows[0].telegram_chat_id)
        : null,
      content: String(rows[0].content),
      buttons: Array.isArray(rows[0].buttons)
        ? (rows[0].buttons as TelegramButton[][])
        : [],
      attemptCount: Number(rows[0].attempt_count),
    };
  } finally {
    client.release();
  }
}

async function completeDelivery(id: string): Promise<void> {
  const client = await getSystemClient();
  try {
    await client.query(
      `UPDATE coach_delivery_outbox
       SET status = 'delivered', delivered_at = now(), locked_at = NULL
       WHERE id = $1::uuid`,
      [id]
    );
  } finally {
    client.release();
  }
}

async function skipDelivery(id: string, reason: string): Promise<void> {
  const client = await getSystemClient();
  try {
    await client.query(
      `UPDATE coach_delivery_outbox
       SET status = 'skipped', locked_at = NULL, last_error = $2
       WHERE id = $1::uuid`,
      [id, reason.slice(0, 200)]
    );
  } finally {
    client.release();
  }
}

async function retryDelivery(
  id: string,
  attemptCount: number,
  errorCode: string
): Promise<void> {
  const client = await getSystemClient();
  const failed = attemptCount >= 8;
  const delaySeconds = Math.min(900, 2 ** Math.min(attemptCount, 9));
  try {
    await client.query(
      `UPDATE coach_delivery_outbox
       SET status = $2,
           available_at = now() + ($3::int * interval '1 second'),
           locked_at = NULL,
           last_error = $4
       WHERE id = $1::uuid`,
      [id, failed ? 'failed' : 'pending', delaySeconds, errorCode.slice(0, 200)]
    );
  } finally {
    client.release();
  }
}

async function cleanupQueues(): Promise<void> {
  const client = await getSystemClient();
  try {
    await client.query(
      `DELETE FROM telegram_update_inbox
       WHERE (status = 'processed' AND processed_at < now() - interval '7 days')
          OR (status = 'dead_letter' AND created_at < now() - interval '30 days')`
    );
    await client.query(
      `DELETE FROM coach_delivery_outbox
       WHERE status IN ('delivered', 'skipped')
         AND created_at < now() - interval '30 days'`
    );
    await client.query(
      `UPDATE coach_action_receipts
       SET status = 'expired'
       WHERE status = 'completed' AND expires_at <= now()`
    );
    await client.query(
      `DELETE FROM coach_action_receipts
       WHERE status IN ('expired', 'undone')
         AND created_at < now() - interval '30 days'`
    );
  } finally {
    client.release();
  }
}

export default {
  enqueueUpdate,
  claimNextUpdate,
  completeUpdate,
  retryUpdate,
  enqueueDelivery,
  claimNextDelivery,
  completeDelivery,
  skipDelivery,
  retryDelivery,
  cleanupQueues,
};
