import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
// @ts-expect-error TS(7016): supertest has no declaration in this workspace.
import request from 'supertest';
import telegramRoutes from '../routes/telegramRoutes.js';
import telegramCoachService from '../services/telegramCoachService.js';

vi.mock('../services/telegramCoachService.js', () => ({
  default: { handleTelegramUpdate: vi.fn() },
}));
vi.mock('../services/telegramApiService.js', () => ({
  getTelegramWebhookSecret: vi.fn(() => 'secret_123'),
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

const app = express();
app.use(express.json());
app.use('/api/telegram', telegramRoutes);

describe('telegram webhook route', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects requests without Telegram secret authentication', async () => {
    const response = await request(app)
      .post('/api/telegram/webhook')
      .send({ update_id: 1 });

    expect(response.statusCode).toBe(401);
    expect(telegramCoachService.handleTelegramUpdate).not.toHaveBeenCalled();
  });

  it('acknowledges a valid update before processing it asynchronously', async () => {
    vi.mocked(telegramCoachService.handleTelegramUpdate).mockResolvedValue();
    const update = { update_id: 1, message: { chat: { id: 2 }, text: 'Hi' } };

    const response = await request(app)
      .post('/api/telegram/webhook')
      .set('x-telegram-bot-api-secret-token', 'secret_123')
      .send(update);

    expect(response.statusCode).toBe(200);
    expect(telegramCoachService.handleTelegramUpdate).toHaveBeenCalledWith(
      update
    );
  });
});
