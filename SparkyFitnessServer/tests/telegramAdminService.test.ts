import { beforeEach, describe, expect, it, vi } from 'vitest';
import telegramAdminService from '../services/telegramAdminService.js';
import {
  clearTelegramBotToken,
  getTelegramRuntimeConfig,
  saveTelegramBotToken,
} from '../services/telegramConfigService.js';
import {
  configureTelegramWebhook,
  getTelegramBotUsername,
  getTelegramWebhookUrl,
  resetTelegramApiCache,
  validateTelegramBotToken,
} from '../services/telegramApiService.js';

vi.mock('../services/telegramConfigService.js', () => ({
  clearTelegramBotToken: vi.fn(),
  getTelegramRuntimeConfig: vi.fn(),
  saveTelegramBotToken: vi.fn(),
}));
vi.mock('../services/telegramApiService.js', () => ({
  configureTelegramWebhook: vi.fn(),
  getTelegramBotUsername: vi.fn(),
  getTelegramWebhookUrl: vi.fn(),
  resetTelegramApiCache: vi.fn(),
  validateTelegramBotToken: vi.fn(),
}));

describe('telegramAdminService', () => {
  const botToken = '123456789:AA-test-secret-token';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTelegramRuntimeConfig).mockResolvedValue({
      botToken,
      webhookSecret: 'webhook-secret',
      source: 'database',
    });
    vi.mocked(getTelegramBotUsername).mockResolvedValue('sparky_bot');
    vi.mocked(getTelegramWebhookUrl).mockReturnValue(
      'https://sparky.example.test/api/telegram/webhook'
    );
  });

  it('validates before persisting and returns only redacted status', async () => {
    const result = await telegramAdminService.updateBotToken(botToken);

    expect(validateTelegramBotToken).toHaveBeenCalledWith(botToken);
    expect(saveTelegramBotToken).toHaveBeenCalledWith(botToken);
    expect(
      vi.mocked(validateTelegramBotToken).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(saveTelegramBotToken).mock.invocationCallOrder[0]);
    expect(resetTelegramApiCache).toHaveBeenCalled();
    expect(configureTelegramWebhook).toHaveBeenCalled();
    expect(result).toEqual({
      configured: true,
      source: 'database',
      botUsername: 'sparky_bot',
      webhookUrl: 'https://sparky.example.test/api/telegram/webhook',
      databaseTokenStored: true,
    });
    expect(JSON.stringify(result)).not.toContain(botToken);
  });

  it('removes persistent credentials before reconfiguring a fallback', async () => {
    await telegramAdminService.removeBotToken();

    expect(clearTelegramBotToken).toHaveBeenCalled();
    expect(
      vi.mocked(clearTelegramBotToken).mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(configureTelegramWebhook).mock.invocationCallOrder[0]
    );
  });
});
