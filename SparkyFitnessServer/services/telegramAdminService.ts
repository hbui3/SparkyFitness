import type { TelegramAdminConfigStatus } from '@workspace/shared';
import {
  clearTelegramBotToken,
  getTelegramRuntimeConfig,
  saveTelegramBotToken,
} from './telegramConfigService.js';
import {
  configureTelegramWebhook,
  getTelegramBotUsername,
  getTelegramWebhookUrl,
  resetTelegramApiCache,
  validateTelegramBotToken,
} from './telegramApiService.js';

async function getStatus(): Promise<TelegramAdminConfigStatus> {
  const config = await getTelegramRuntimeConfig();
  const configured = Boolean(config.botToken && config.webhookSecret);
  const botUsername = configured
    ? await getTelegramBotUsername().catch(() => null)
    : null;
  return {
    configured,
    source: config.source,
    botUsername,
    webhookUrl: getTelegramWebhookUrl(),
    databaseTokenStored: config.source === 'database',
  };
}

async function updateBotToken(
  botToken: string
): Promise<TelegramAdminConfigStatus> {
  await validateTelegramBotToken(botToken);
  await saveTelegramBotToken(botToken);
  resetTelegramApiCache();
  await configureTelegramWebhook();
  return getStatus();
}

async function removeBotToken(): Promise<TelegramAdminConfigStatus> {
  await clearTelegramBotToken();
  resetTelegramApiCache();
  await configureTelegramWebhook();
  return getStatus();
}

export default {
  getStatus,
  updateBotToken,
  removeBotToken,
};
