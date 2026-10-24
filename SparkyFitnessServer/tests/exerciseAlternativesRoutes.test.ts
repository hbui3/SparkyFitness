import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
// @ts-expect-error TS(7016): no type declarations shipped for supertest
import request from 'supertest';
import {
  ExerciseNotFoundError,
  getExerciseAlternatives,
} from '../services/exerciseAlternativesService.js';
// @ts-expect-error TS(2691): the router is exported with module.exports
import exerciseRoutesV2 from '../routes/v2/exerciseRoutes.js';

vi.mock('../services/exerciseAlternativesService.js', () => {
  class ExerciseNotFoundError extends Error {
    constructor() {
      super('Exercise not found');
      this.name = 'ExerciseNotFoundError';
    }
  }
  return { getExerciseAlternatives: vi.fn(), ExerciseNotFoundError };
});
vi.mock('../services/exerciseService.js', () => ({ default: {} }));
vi.mock('../middleware/checkPermissionMiddleware.js', () => ({
  default: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.userId = 'owner-1';
    req.authenticatedUserId = 'actor-1';
    next();
  },
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

const app = express();
app.use('/v2/exercises', exerciseRoutesV2);
app.use(
  (
    err: Error & { status?: number },
    _req: Request,
    res: Response,
    _next: NextFunction
  ) => {
    res.status(err.status || 500).json({ error: err.message });
  }
);

const EXERCISE_ID = '11111111-1111-4111-8111-111111111111';

const response = {
  source: {
    id: EXERCISE_ID,
    name: 'Bench Press',
    primary_muscles: ['chest'],
    equipment: ['barbell'],
  },
  alternatives: [
    {
      origin: 'catalog',
      id: 'Cable_Crossover',
      name: 'Cable Crossover',
      source: 'free-exercise-db',
      category: 'strength',
      modality: 'weight_reps',
      level: null,
      mechanic: null,
      force: null,
      equipment: ['cable'],
      primary_muscles: ['chest'],
      secondary_muscles: [],
      images: [],
      instructions: [],
      description: null,
      calories_per_hour: null,
      score: 60,
      reasons: ['same_primary_muscles'],
      last_performed_date: null,
    },
  ],
  rankable: true,
  catalog_available: true,
};

beforeEach(() => {
  vi.mocked(getExerciseAlternatives).mockReset();
  vi.mocked(getExerciseAlternatives).mockResolvedValue(
    response as Awaited<ReturnType<typeof getExerciseAlternatives>>
  );
});

describe('GET /v2/exercises/:exerciseId/alternatives', () => {
  it('parses the query and passes both actors through', async () => {
    const res = await request(app).get(
      `/v2/exercises/${EXERCISE_ID}/alternatives?mode=different_equipment&equipment=dumbbell,%20bands&excludeMuscles=shoulders&excludeIds=a,b&includeCatalog=false&limit=5`
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual(response);
    expect(getExerciseAlternatives).toHaveBeenCalledWith(
      'owner-1',
      'actor-1',
      EXERCISE_ID,
      {
        mode: 'different_equipment',
        equipment: ['dumbbell', 'bands'],
        excludeMuscles: ['shoulders'],
        excludeIds: ['a', 'b'],
        includeCatalog: false,
        limit: 5,
      }
    );
  });

  it('applies defaults', async () => {
    await request(app).get(`/v2/exercises/${EXERCISE_ID}/alternatives`);
    expect(getExerciseAlternatives).toHaveBeenCalledWith(
      'owner-1',
      'actor-1',
      EXERCISE_ID,
      {
        mode: 'similar',
        equipment: [],
        excludeMuscles: [],
        excludeIds: [],
        includeCatalog: true,
        limit: 20,
      }
    );
  });

  it.each([
    ['/v2/exercises/not-a-uuid/alternatives'],
    [`/v2/exercises/${EXERCISE_ID}/alternatives?mode=random`],
    [`/v2/exercises/${EXERCISE_ID}/alternatives?limit=500`],
    [`/v2/exercises/${EXERCISE_ID}/alternatives?unknown=1`],
  ])('rejects %s with 400', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(400);
    expect(getExerciseAlternatives).not.toHaveBeenCalled();
  });

  it('maps a missing exercise to 404', async () => {
    vi.mocked(getExerciseAlternatives).mockRejectedValue(
      new ExerciseNotFoundError()
    );
    const res = await request(app).get(
      `/v2/exercises/${EXERCISE_ID}/alternatives`
    );
    expect(res.status).toBe(404);
  });

  it('refuses to send a response that breaks the contract', async () => {
    vi.mocked(getExerciseAlternatives).mockResolvedValue({
      ...response,
      alternatives: [{ ...response.alternatives[0], reasons: ['bogus'] }],
    } as unknown as Awaited<ReturnType<typeof getExerciseAlternatives>>);
    const res = await request(app).get(
      `/v2/exercises/${EXERCISE_ID}/alternatives`
    );
    expect(res.status).toBe(500);
  });
});
