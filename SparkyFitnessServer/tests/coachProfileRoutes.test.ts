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
  primaryGoal: 'Build strength',
  calorieTarget: 2200,
  proteinTargetG: 140,
  waterTargetMl: 2500,
  excludedIngredients: ['tofu'],
  preferredIngredients: ['lentils'],
  dislikedIngredients: [],
  routines: [],
  coachingNotes: null,
};

describe('coach profile routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('always reads the authenticated owner profile during context switching', async () => {
    vi.mocked(coachProfileService.getCoachProfile).mockResolvedValue({
      ...validProfile,
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

  it('rejects invalid targets before calling the service', async () => {
    const response = await request(app)
      .put('/api/coach-profile')
      .send({ ...validProfile, calorieTarget: 100 });

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
