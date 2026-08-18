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
import type { UpdateCoachProfileRequest } from '@workspace/shared';

vi.mock('../services/coachProfileService.js', () => ({
  default: {
    getCoachProfile: vi.fn(),
    updateCoachProfile: vi.fn(),
    validateMealSuggestion: vi.fn(),
  },
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
