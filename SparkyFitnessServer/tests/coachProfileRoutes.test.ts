import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
// @ts-expect-error TS(7016): supertest has no declaration in this workspace.
import request from 'supertest';
import coachProfileRoutes from '../routes/coachProfileRoutes.js';
import coachProfileService from '../services/coachProfileService.js';
import telegramCoachService from '../services/telegramCoachService.js';
import coachMemoryService from '../services/coachMemoryService.js';
import coachContextService from '../services/coachContextService.js';
import type { UpdateCoachProfileRequest } from '@workspace/shared';

vi.mock('../services/coachProfileService.js', () => ({
  default: {
    getCoachProfile: vi.fn(),
    updateCoachProfile: vi.fn(),
    validateMealSuggestion: vi.fn(),
  },
}));
vi.mock('../services/telegramCoachService.js', () => ({
  default: {
    getConnectionStatus: vi.fn(),
    createLink: vi.fn(),
    disconnect: vi.fn(),
  },
}));
vi.mock('../services/coachMemoryService.js', () => ({
  default: {
    listMemories: vi.fn(),
    createMemory: vi.fn(),
    updateMemory: vi.fn(),
    deleteMemory: vi.fn(),
  },
}));
vi.mock('../services/coachContextService.js', () => ({
  default: { getCoachTodayStatus: vi.fn() },
}));
vi.mock('../services/coachEventService.js', () => ({
  default: { publish: vi.fn(), subscribe: vi.fn(() => vi.fn()) },
}));

vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.userId = 'delegated-user';
    req.authenticatedUserId = 'owner-user';
    next();
  },
}));

const app = express();
app.use(express.json());
app.use('/api/coach-profile', coachProfileRoutes);
app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: error.message });
});

const validProfile: UpdateCoachProfileRequest = {
  enabled: true,
  dietaryPattern: 'vegetarian',
  excludedIngredients: ['tofu'],
  preferredIngredients: ['lentils'],
  dislikedIngredients: [],
  routines: [],
  coachingNotes: null,
  adaptiveCheckInsEnabled: true,
  adaptiveStartTime: '07:00',
  adaptiveEndTime: '20:00',
  adaptiveIntervalMinutes: 120,
  proactiveCategories: ['nutrition', 'hydration', 'training', 'recovery'],
  memoryEnabled: true,
  autoMemoryEnabled: false,
  dailyCheckInEnabled: true,
  dailyCheckInTime: '20:00',
  weeklyReviewEnabled: true,
  weeklyReviewDay: 0,
  weeklyReviewTime: '18:00',
};

const inheritedGoals = {
  primaryGoal: 'gain_weight',
  calorieTarget: 3000,
  proteinTargetG: 160,
  waterTargetMl: 3000,
};

describe('coach profile routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('always reads the authenticated owner profile during context switching', async () => {
    vi.mocked(coachProfileService.getCoachProfile).mockResolvedValue({
      ...validProfile,
      ...inheritedGoals,
      updatedAt: null,
    });

    const response = await request(app).get('/api/coach-profile');

    expect(response.statusCode).toBe(200);
    expect(coachProfileService.getCoachProfile).toHaveBeenCalledWith(
      'owner-user'
    );
  });

  it('validates and saves a complete profile', async () => {
    vi.mocked(coachProfileService.updateCoachProfile).mockResolvedValue({
      ...validProfile,
      ...inheritedGoals,
      updatedAt: '2026-08-18T10:00:00.000Z',
    });

    const response = await request(app)
      .put('/api/coach-profile')
      .send(validProfile);

    expect(response.statusCode).toBe(200);
    expect(coachProfileService.updateCoachProfile).toHaveBeenCalledWith(
      'owner-user',
      validProfile
    );
  });

  it('rejects an invalid proactive delivery time before calling the service', async () => {
    const response = await request(app)
      .put('/api/coach-profile')
      .send({ ...validProfile, dailyCheckInTime: '25:00' });

    expect(response.statusCode).toBe(400);
    expect(coachProfileService.updateCoachProfile).not.toHaveBeenCalled();
  });

  it('rejects an adaptive window whose end is not later than its start', async () => {
    const response = await request(app)
      .put('/api/coach-profile')
      .send({
        ...validProfile,
        adaptiveStartTime: '20:00',
        adaptiveEndTime: '07:00',
      });

    expect(response.statusCode).toBe(400);
    expect(coachProfileService.updateCoachProfile).not.toHaveBeenCalled();
  });

  it('returns the deterministic today status for the authenticated owner', async () => {
    vi.mocked(coachContextService.getCoachTodayStatus).mockResolvedValue({
      date: '2026-08-19',
      timezone: 'Europe/Berlin',
      caloriesConsumed: 2283,
      caloriesBurned: 428,
      netCalories: 1855,
      calorieTarget: 3221,
      caloriesRemaining: 1366,
      proteinConsumedG: 194.9,
      proteinTargetG: 157,
      proteinRemainingG: 0,
      waterConsumedMl: 1500,
      waterTargetMl: 3000,
      waterRemainingMl: 1500,
      nextAction: 'Wasser trinken.',
    });

    const response = await request(app)
      .get('/api/coach-profile/today')
      .set('Accept-Language', 'de');

    expect(response.statusCode).toBe(200);
    expect(response.body.netCalories).toBe(1855);
    expect(coachContextService.getCoachTodayStatus).toHaveBeenCalledWith(
      'owner-user',
      'de'
    );
  });

  it('manages private memories only for the authenticated owner', async () => {
    const memoryId = '123e4567-e89b-42d3-a456-426614174000';
    const memory = {
      id: memoryId,
      category: 'routine' as const,
      content: 'Training dienstags und donnerstags',
      source: 'user' as const,
      active: true,
      pinned: false,
      createdAt: '2026-08-19T10:00:00.000Z',
      updatedAt: '2026-08-19T10:00:00.000Z',
    };
    vi.mocked(coachMemoryService.listMemories).mockResolvedValue([memory]);
    vi.mocked(coachMemoryService.createMemory).mockResolvedValue(memory);
    vi.mocked(coachMemoryService.updateMemory).mockResolvedValue({
      ...memory,
      pinned: true,
    });
    vi.mocked(coachMemoryService.deleteMemory).mockResolvedValue(true);

    const listed = await request(app).get('/api/coach-profile/memories');
    const created = await request(app)
      .post('/api/coach-profile/memories')
      .send({ category: 'routine', content: memory.content });
    const updated = await request(app)
      .patch(`/api/coach-profile/memories/${memoryId}`)
      .send({ pinned: true });
    const removed = await request(app).delete(
      `/api/coach-profile/memories/${memoryId}`
    );

    expect(listed.statusCode).toBe(200);
    expect(created.statusCode).toBe(201);
    expect(updated.body.pinned).toBe(true);
    expect(removed.statusCode).toBe(204);
    expect(coachMemoryService.createMemory).toHaveBeenCalledWith('owner-user', {
      category: 'routine',
      content: memory.content,
      pinned: false,
    });
    expect(coachMemoryService.deleteMemory).toHaveBeenCalledWith(
      'owner-user',
      memoryId
    );
  });

  it('creates and removes an owner-only Telegram coach connection', async () => {
    vi.mocked(telegramCoachService.getConnectionStatus).mockResolvedValue({
      available: true,
      connected: false,
      botUsername: 'sparky_test_bot',
      telegramUsername: null,
    });
    vi.mocked(telegramCoachService.createLink).mockResolvedValue({
      url: 'https://t.me/sparky_test_bot?start=one-time-token',
      expiresAt: '2026-08-18T10:15:00.000Z',
      botUsername: 'sparky_test_bot',
    });
    vi.mocked(telegramCoachService.disconnect).mockResolvedValue({
      disconnected: true,
    });

    const status = await request(app).get('/api/coach-profile/telegram');
    const link = await request(app).post('/api/coach-profile/telegram/link');
    const removed = await request(app).delete('/api/coach-profile/telegram');

    expect(status.statusCode).toBe(200);
    expect(link.statusCode).toBe(200);
    expect(link.body.url).toContain('https://t.me/sparky_test_bot');
    expect(telegramCoachService.createLink).toHaveBeenCalledWith('owner-user');
    expect(removed.statusCode).toBe(200);
    expect(removed.body).toEqual({ disconnected: true });
  });

  it('returns deterministic meal validation results', async () => {
    vi.mocked(coachProfileService.validateMealSuggestion).mockResolvedValue({
      allowed: false,
      violations: [
        {
          type: 'dietary_pattern',
          ingredient: 'steak',
          matchedTerm: 'steak',
          reason: 'blocked',
        },
      ],
    });

    const response = await request(app)
      .post('/api/coach-profile/validate-meal')
      .send({ ingredients: ['steak'] });

    expect(response.statusCode).toBe(200);
    expect(response.body.allowed).toBe(false);
    expect(coachProfileService.validateMealSuggestion).toHaveBeenCalledWith(
      'owner-user',
      ['steak']
    );
  });
});
