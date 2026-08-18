import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTelegramWebhook,
  getTelegramBotUsername,
  resetTelegramApiCache,
  sendTelegramMessage,
} from '../services/telegramApiService.js';

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../services/telegramConfigService.js', () => ({
  getTelegramRuntimeConfig: vi.fn(async () => {
    const botToken =
      process.env.SPARKY_FITNESS_TELEGRAM_BOT_TOKEN?.trim() || null;
    const webhookSecret =
      process.env.SPARKY_FITNESS_TELEGRAM_WEBHOOK_SECRET?.trim() || null;
    return {
      botToken,
      webhookSecret,
      source: botToken && webhookSecret ? 'environment' : 'none',
    };
  }),
}));

describe('telegramApiService', () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetTelegramApiCache();
    process.env.SPARKY_FITNESS_TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.SPARKY_FITNESS_TELEGRAM_WEBHOOK_SECRET = 'test_secret-123';
    process.env.SPARKY_FITNESS_FRONTEND_URL = 'https://sparky.example.test';
    delete process.env.SPARKY_FITNESS_TELEGRAM_WEBHOOK_URL;
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it('loads the bot identity and configures the public HTTPS webhook', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, result: { username: 'sparky_bot' } }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        })
      );

    await expect(getTelegramBotUsername()).resolves.toBe('sparky_bot');
    await configureTelegramWebhook();

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.telegram.org/bottest-token/setWebhook',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          url: 'https://sparky.example.test/api/telegram/webhook',
          secret_token: 'test_secret-123',
          allowed_updates: ['message'],
        }),
      })
    );
  });

  it('delivers long formatted coach messages as Telegram-safe text chunks', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
      )
    );
    const content = `### Coach\n\n**Aktuell:** ${'x'.repeat(4_200)}`;

    await sendTelegramMessage('12345', content);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const secondRequest = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(firstRequest.chat_id).toBe('12345');
    expect(firstRequest.text).not.toContain('###');
    expect(firstRequest.text).not.toContain('**');
    expect(firstRequest.text.length).toBeLessThanOrEqual(4_000);
    expect(secondRequest.text.length).toBeGreaterThan(0);
  });
});
