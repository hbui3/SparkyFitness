import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import telegramConfigRepository from '../models/telegramConfigRepository.js';
import {
  clearTelegramBotToken,
  getTelegramRuntimeConfig,
  resetTelegramConfigCache,
  saveTelegramBotToken,
} from '../services/telegramConfigService.js';

vi.mock('../models/telegramConfigRepository.js', () => ({
  default: {
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    clearSettings: vi.fn(),
  },
}));

describe('telegramConfigService', () => {
  const originalBotToken = process.env.SPARKY_FITNESS_TELEGRAM_BOT_TOKEN;
  const originalWebhookSecret =
    process.env.SPARKY_FITNESS_TELEGRAM_WEBHOOK_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    resetTelegramConfigCache();
    delete process.env.SPARKY_FITNESS_TELEGRAM_BOT_TOKEN;
    delete process.env.SPARKY_FITNESS_TELEGRAM_WEBHOOK_SECRET;
    vi.mocked(telegramConfigRepository.getSettings).mockResolvedValue({
      id: 1,
      encrypted_bot_token: null,
      bot_token_iv: null,
      bot_token_tag: null,
      encrypted_webhook_secret: null,
      webhook_secret_iv: null,
      webhook_secret_tag: null,
      updated_at: new Date(),
    });
  });

  afterEach(() => {
    if (originalBotToken === undefined) {
      delete process.env.SPARKY_FITNESS_TELEGRAM_BOT_TOKEN;
    } else {
      process.env.SPARKY_FITNESS_TELEGRAM_BOT_TOKEN = originalBotToken;
    }
    if (originalWebhookSecret === undefined) {
      delete process.env.SPARKY_FITNESS_TELEGRAM_WEBHOOK_SECRET;
    } else {
      process.env.SPARKY_FITNESS_TELEGRAM_WEBHOOK_SECRET =
        originalWebhookSecret;
    }
  });

  it('encrypts the UI token and an automatically generated webhook secret', async () => {
    vi.mocked(telegramConfigRepository.saveSettings).mockResolvedValue();

    await saveTelegramBotToken('123456789:AA-test-bot-token');

    const saved = vi.mocked(telegramConfigRepository.saveSettings).mock
      .calls[0][0];
    expect(saved.encryptedBotToken).not.toContain('AA-test-bot-token');
    expect(saved.botTokenIv).toBeTruthy();
    expect(saved.botTokenTag).toBeTruthy();
    const runtime = await getTelegramRuntimeConfig();
    expect(runtime).toEqual(
      expect.objectContaining({
        botToken: '123456789:AA-test-bot-token',
        webhookSecret: expect.stringMatching(/^[a-f0-9]{64}$/),
        source: 'database',
      })
    );
    expect(saved.encryptedWebhookSecret).not.toBe(runtime.webhookSecret);
  });

  it('restores and decrypts the database configuration after a restart', async () => {
    vi.mocked(telegramConfigRepository.saveSettings).mockResolvedValue();
    await saveTelegramBotToken('123456789:AA-persistent-bot-token');
    const saved = vi.mocked(telegramConfigRepository.saveSettings).mock
      .calls[0][0];
    vi.mocked(telegramConfigRepository.getSettings).mockResolvedValue({
      id: 1,
      encrypted_bot_token: saved.encryptedBotToken,
      bot_token_iv: saved.botTokenIv,
      bot_token_tag: saved.botTokenTag,
      encrypted_webhook_secret: saved.encryptedWebhookSecret,
      webhook_secret_iv: saved.webhookSecretIv,
      webhook_secret_tag: saved.webhookSecretTag,
      updated_at: new Date(),
    });

    resetTelegramConfigCache();

    await expect(getTelegramRuntimeConfig()).resolves.toEqual({
      botToken: '123456789:AA-persistent-bot-token',
      webhookSecret: expect.stringMatching(/^[a-f0-9]{64}$/),
      source: 'database',
    });
  });

  it('uses environment variables only when no database token exists', async () => {
    process.env.SPARKY_FITNESS_TELEGRAM_BOT_TOKEN = 'env-token';
    process.env.SPARKY_FITNESS_TELEGRAM_WEBHOOK_SECRET = 'env-secret';

    await expect(getTelegramRuntimeConfig()).resolves.toEqual({
      botToken: 'env-token',
      webhookSecret: 'env-secret',
      source: 'environment',
    });
  });

  it('clears persistent credentials and invalidates the runtime cache', async () => {
    vi.mocked(telegramConfigRepository.clearSettings).mockResolvedValue(true);

    await expect(clearTelegramBotToken()).resolves.toBe(true);
    expect(telegramConfigRepository.clearSettings).toHaveBeenCalled();
  });
});
