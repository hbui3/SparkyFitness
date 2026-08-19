import type { CoachTelegramConnections } from '@workspace/shared';
import { getClient, getSystemClient } from '../db/poolManager.js';

async function getConnection(
  userId: string
): Promise<CoachTelegramConnections | undefined> {
  const client = await getClient(userId, userId);
  try {
    const { rows } = await client.query(
      `SELECT
         id,
         user_id,
         telegram_chat_id::text,
         telegram_user_id::text,
         telegram_username,
         enabled,
         link_token_hash,
         link_token_expires_at,
         last_telegram_update_id::text,
         created_at,
         updated_at
       FROM coach_telegram_connections
       WHERE user_id = $1`,
      [userId]
    );
    return rows[0] as CoachTelegramConnections | undefined;
  } finally {
    client.release();
  }
}

async function storeLinkToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date
): Promise<void> {
  const client = await getClient(userId, userId);
  try {
    await client.query(
      `INSERT INTO coach_telegram_connections (
         user_id,
         link_token_hash,
         link_token_expires_at
       ) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         link_token_hash = EXCLUDED.link_token_hash,
         link_token_expires_at = EXCLUDED.link_token_expires_at,
         updated_at = now()`,
      [userId, tokenHash, expiresAt]
    );
  } finally {
    client.release();
  }
}

async function claimLinkToken(input: {
  tokenHash: string;
  telegramChatId: string;
  telegramUserId: string | null;
  telegramUsername: string | null;
}): Promise<string | null> {
  const client = await getSystemClient();
  try {
    await client.query('BEGIN');
    const pending = await client.query(
      `SELECT user_id
       FROM coach_telegram_connections
       WHERE link_token_hash = $1
         AND link_token_expires_at > now()
       FOR UPDATE`,
      [input.tokenHash]
    );
    const userId = pending.rows[0]?.user_id;
    if (!userId) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(
      `UPDATE coach_telegram_connections
       SET telegram_chat_id = NULL,
           telegram_user_id = NULL,
           telegram_username = NULL,
           enabled = FALSE,
           updated_at = now()
       WHERE telegram_chat_id = $1
         AND user_id <> $2`,
      [input.telegramChatId, userId]
    );
    await client.query(
      `UPDATE coach_telegram_connections
       SET telegram_chat_id = $2::bigint,
           telegram_user_id = $3::bigint,
           telegram_username = $4,
           enabled = TRUE,
           link_token_hash = NULL,
           link_token_expires_at = NULL,
           last_telegram_update_id = NULL,
           updated_at = now()
       WHERE user_id = $1`,
      [
        userId,
        input.telegramChatId,
        input.telegramUserId,
        input.telegramUsername,
      ]
    );
    await client.query('COMMIT');
    return String(userId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function claimIncomingUpdate(
  telegramChatId: string,
  updateId: number
): Promise<{ userId: string; claimed: boolean } | null> {
  const client = await getSystemClient();
  try {
    const { rows } = await client.query(
      `WITH claimed AS (
         UPDATE coach_telegram_connections
         SET last_telegram_update_id = $2,
             updated_at = now()
         WHERE telegram_chat_id = $1::bigint
           AND enabled = TRUE
           AND (
             last_telegram_update_id IS NULL
             OR last_telegram_update_id < $2
           )
         RETURNING user_id
       )
       SELECT user_id, TRUE AS claimed FROM claimed
       UNION ALL
       SELECT user_id, FALSE AS claimed
       FROM coach_telegram_connections
       WHERE telegram_chat_id = $1::bigint
         AND enabled = TRUE
         AND NOT EXISTS (SELECT 1 FROM claimed)
       LIMIT 1`,
      [telegramChatId, updateId]
    );
    return rows[0]?.user_id
      ? { userId: String(rows[0].user_id), claimed: rows[0].claimed === true }
      : null;
  } finally {
    client.release();
  }
}

async function getConnectionByChatId(
  telegramChatId: string
): Promise<{ userId: string; telegramUserId: string | null } | null> {
  const client = await getSystemClient();
  try {
    const { rows } = await client.query(
      `SELECT user_id, telegram_user_id::text
       FROM coach_telegram_connections
       WHERE telegram_chat_id = $1::bigint
         AND enabled = TRUE
       LIMIT 1`,
      [telegramChatId]
    );
    return rows[0]?.user_id
      ? {
          userId: String(rows[0].user_id),
          telegramUserId: rows[0].telegram_user_id
            ? String(rows[0].telegram_user_id)
            : null,
        }
      : null;
  } finally {
    client.release();
  }
}

async function getConnectedChatId(userId: string): Promise<string | null> {
  const client = await getClient(userId, userId);
  try {
    const { rows } = await client.query(
      `SELECT telegram_chat_id::text
       FROM coach_telegram_connections
       WHERE user_id = $1
         AND enabled = TRUE
         AND telegram_chat_id IS NOT NULL`,
      [userId]
    );
    return rows[0]?.telegram_chat_id ? String(rows[0].telegram_chat_id) : null;
  } finally {
    client.release();
  }
}

async function disconnectUser(userId: string): Promise<boolean> {
  const client = await getClient(userId, userId);
  try {
    const result = await client.query(
      `UPDATE coach_telegram_connections
       SET telegram_chat_id = NULL,
           telegram_user_id = NULL,
           telegram_username = NULL,
           enabled = FALSE,
           link_token_hash = NULL,
           link_token_expires_at = NULL,
           last_telegram_update_id = NULL,
           updated_at = now()
       WHERE user_id = $1`,
      [userId]
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

async function disconnectChat(telegramChatId: string): Promise<boolean> {
  const client = await getSystemClient();
  try {
    const result = await client.query(
      `UPDATE coach_telegram_connections
       SET telegram_chat_id = NULL,
           telegram_user_id = NULL,
           telegram_username = NULL,
           enabled = FALSE,
           last_telegram_update_id = NULL,
           updated_at = now()
       WHERE telegram_chat_id = $1::bigint`,
      [telegramChatId]
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

export default {
  getConnection,
  storeLinkToken,
  claimLinkToken,
  claimIncomingUpdate,
  getConnectionByChatId,
  getConnectedChatId,
  disconnectUser,
  disconnectChat,
};
