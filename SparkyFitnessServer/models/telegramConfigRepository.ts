import type { TelegramCoachSettings } from '@workspace/shared';
import { getSystemClient } from '../db/poolManager.js';

export interface EncryptedTelegramConfig {
  encryptedBotToken: string;
  botTokenIv: string;
  botTokenTag: string;
  encryptedWebhookSecret: string;
  webhookSecretIv: string;
  webhookSecretTag: string;
}

async function getSettings(): Promise<TelegramCoachSettings | undefined> {
  const client = await getSystemClient();
  try {
    const { rows } = await client.query(
      `SELECT
         id,
         encrypted_bot_token,
         bot_token_iv,
         bot_token_tag,
         encrypted_webhook_secret,
         webhook_secret_iv,
         webhook_secret_tag,
         updated_at
       FROM telegram_coach_settings
       WHERE id = 1`
    );
    return rows[0] as TelegramCoachSettings | undefined;
  } finally {
    client.release();
  }
}

async function saveSettings(config: EncryptedTelegramConfig): Promise<void> {
  const client = await getSystemClient();
  try {
    await client.query(
      `INSERT INTO telegram_coach_settings (
         id,
         encrypted_bot_token,
         bot_token_iv,
         bot_token_tag,
         encrypted_webhook_secret,
         webhook_secret_iv,
         webhook_secret_tag,
         updated_at
       ) VALUES (1, $1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (id) DO UPDATE SET
         encrypted_bot_token = EXCLUDED.encrypted_bot_token,
         bot_token_iv = EXCLUDED.bot_token_iv,
         bot_token_tag = EXCLUDED.bot_token_tag,
         encrypted_webhook_secret = EXCLUDED.encrypted_webhook_secret,
         webhook_secret_iv = EXCLUDED.webhook_secret_iv,
         webhook_secret_tag = EXCLUDED.webhook_secret_tag,
         updated_at = now()`,
      [
        config.encryptedBotToken,
        config.botTokenIv,
        config.botTokenTag,
        config.encryptedWebhookSecret,
        config.webhookSecretIv,
        config.webhookSecretTag,
      ]
    );
  } finally {
    client.release();
  }
}

async function clearSettings(): Promise<boolean> {
  const client = await getSystemClient();
  try {
    const result = await client.query(
      `UPDATE telegram_coach_settings
       SET encrypted_bot_token = NULL,
           bot_token_iv = NULL,
           bot_token_tag = NULL,
           encrypted_webhook_secret = NULL,
           webhook_secret_iv = NULL,
           webhook_secret_tag = NULL,
           updated_at = now()
       WHERE id = 1
         AND encrypted_bot_token IS NOT NULL`
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

export default {
  getSettings,
  saveSettings,
  clearSettings,
};
