import { randomBytes } from 'crypto';
import telegramConfigRepository from '../models/telegramConfigRepository.js';
import { decrypt, encrypt, ENCRYPTION_KEY } from '../security/encryption.js';

export type TelegramConfigSource = 'database' | 'environment' | 'none';

export interface TelegramRuntimeConfig {
  botToken: string | null;
  webhookSecret: string | null;
  source: TelegramConfigSource;
}

const CACHE_TTL_MS = 30_000;
let cachedConfig:
  | { value: TelegramRuntimeConfig; expiresAt: number }
  | undefined;

function environmentConfig(): TelegramRuntimeConfig {
  const botToken =
    process.env.SPARKY_FITNESS_TELEGRAM_BOT_TOKEN?.trim() || null;
  const webhookSecret =
    process.env.SPARKY_FITNESS_TELEGRAM_WEBHOOK_SECRET?.trim() || null;
  return botToken && webhookSecret
    ? { botToken, webhookSecret, source: 'environment' }
    : { botToken: null, webhookSecret: null, source: 'none' };
}

async function databaseConfig(): Promise<TelegramRuntimeConfig | null> {
  const settings = await telegramConfigRepository.getSettings();
  if (
    !settings?.encrypted_bot_token ||
    !settings.bot_token_iv ||
    !settings.bot_token_tag ||
    !settings.encrypted_webhook_secret ||
    !settings.webhook_secret_iv ||
    !settings.webhook_secret_tag
  ) {
    return null;
  }
  const [botToken, webhookSecret] = await Promise.all([
    decrypt(
      settings.encrypted_bot_token,
      settings.bot_token_iv,
      settings.bot_token_tag,
      ENCRYPTION_KEY
    ),
    decrypt(
      settings.encrypted_webhook_secret,
      settings.webhook_secret_iv,
      settings.webhook_secret_tag,
      ENCRYPTION_KEY
    ),
  ]);
  return botToken && webhookSecret
    ? { botToken, webhookSecret, source: 'database' }
    : null;
}

export async function getTelegramRuntimeConfig(
  forceRefresh = false
): Promise<TelegramRuntimeConfig> {
  if (!forceRefresh && cachedConfig && cachedConfig.expiresAt > Date.now()) {
    return cachedConfig.value;
  }
  const value = (await databaseConfig()) ?? environmentConfig();
  cachedConfig = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function saveTelegramBotToken(botToken: string): Promise<void> {
  const webhookSecret = randomBytes(32).toString('hex');
  const [encryptedToken, encryptedSecret] = await Promise.all([
    encrypt(botToken, ENCRYPTION_KEY),
    encrypt(webhookSecret, ENCRYPTION_KEY),
  ]);
  if (
    !encryptedToken.encryptedText ||
    !encryptedToken.iv ||
    !encryptedToken.tag ||
    !encryptedSecret.encryptedText ||
    !encryptedSecret.iv ||
    !encryptedSecret.tag
  ) {
    throw new Error('Telegram credential encryption failed.');
  }
  await telegramConfigRepository.saveSettings({
    encryptedBotToken: encryptedToken.encryptedText,
    botTokenIv: encryptedToken.iv,
    botTokenTag: encryptedToken.tag,
    encryptedWebhookSecret: encryptedSecret.encryptedText,
    webhookSecretIv: encryptedSecret.iv,
    webhookSecretTag: encryptedSecret.tag,
  });
  cachedConfig = {
    value: { botToken, webhookSecret, source: 'database' },
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
}

export async function clearTelegramBotToken(): Promise<boolean> {
  const cleared = await telegramConfigRepository.clearSettings();
  cachedConfig = undefined;
  return cleared;
}

export function resetTelegramConfigCache(): void {
  cachedConfig = undefined;
}

export default {
  getTelegramRuntimeConfig,
  saveTelegramBotToken,
  clearTelegramBotToken,
  resetTelegramConfigCache,
};
