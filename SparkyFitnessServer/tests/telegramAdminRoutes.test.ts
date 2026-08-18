import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
// @ts-expect-error TS(7016): supertest has no declaration in this workspace.
import request from 'supertest';
import telegramAdminRoutes from '../routes/telegramAdminRoutes.js';
import telegramAdminService from '../services/telegramAdminService.js';

vi.mock('../middleware/authMiddleware.js', () => ({
  isAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../services/telegramAdminService.js', () => ({
  default: {
    getStatus: vi.fn(),
    updateBotToken: vi.fn(),
    removeBotToken: vi.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use('/api/admin/telegram-coach', telegramAdminRoutes);
app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: error.message });
});

const status = {
  configured: true,
  source: 'database' as const,
  botUsername: 'sparky_bot',
  webhookUrl: 'https://sparky.example.test/api/telegram/webhook',
  databaseTokenStored: true,
};

describe('telegram admin routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('never returns the submitted bot token', async () => {
    vi.mocked(telegramAdminService.updateBotToken).mockResolvedValue(status);
    const botToken = '123456789:AA-test-secret-token';

    const response = await request(app)
      .put('/api/admin/telegram-coach')
      .send({ botToken });

    expect(response.statusCode).toBe(200);
    expect(telegramAdminService.updateBotToken).toHaveBeenCalledWith(botToken);
    expect(JSON.stringify(response.body)).not.toContain(botToken);
    expect(response.body).toEqual(status);
  });

  it('rejects an invalid short token before storage', async () => {
    const response = await request(app)
      .put('/api/admin/telegram-coach')
      .send({ botToken: 'short' });

    expect(response.statusCode).toBe(400);
    expect(telegramAdminService.updateBotToken).not.toHaveBeenCalled();
  });

  it('returns status after removing persistent credentials', async () => {
    vi.mocked(telegramAdminService.removeBotToken).mockResolvedValue({
      ...status,
      configured: false,
      source: 'none',
      botUsername: null,
      databaseTokenStored: false,
    });

    const response = await request(app).delete('/api/admin/telegram-coach');

    expect(response.statusCode).toBe(200);
    expect(response.body.databaseTokenStored).toBe(false);
  });
});
