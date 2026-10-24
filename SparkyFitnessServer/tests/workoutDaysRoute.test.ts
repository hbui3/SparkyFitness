import { vi, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'supertest'
import request from 'supertest';
import express from 'express';
import exerciseEntryRepository from '../models/exerciseEntry.js';
import reportRoutesV2 from '../routes/v2/reportRoutes.js';

vi.mock('../middleware/onBehalfOfMiddleware.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: (req: any, _res: any, next: any) => {
    req.userId = 'user-1';
    next();
  },
}));

vi.mock('../middleware/checkPermissionMiddleware.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../models/exerciseEntry.js', () => ({
  default: { getWorkoutDayCounts: vi.fn() },
}));

vi.mock('../services/alcoholWeekService.js', () => ({ default: {} }));
vi.mock('../services/hydrationNutritionRangeService.js', () => ({
  default: {},
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const repo = exerciseEntryRepository as any;

const app = express();
app.use('/v2/reports', reportRoutesV2);

describe('GET /v2/reports/workout-days (#2461)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the sparse per-day workout counts for the window', async () => {
    repo.getWorkoutDayCounts.mockResolvedValue([
      { date: '2025-10-03', count: 1 },
      { date: '2026-09-20', count: 3 },
    ]);

    const res = await request(app).get(
      '/v2/reports/workout-days?start=2025-10-01&end=2026-09-24'
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      days: [
        { date: '2025-10-03', count: 1 },
        { date: '2026-09-20', count: 3 },
      ],
    });
    expect(repo.getWorkoutDayCounts).toHaveBeenCalledWith(
      'user-1',
      '2025-10-01',
      '2026-09-24'
    );
  });

  it('rejects a window longer than 366 days', async () => {
    const res = await request(app).get(
      '/v2/reports/workout-days?start=2024-01-01&end=2026-09-24'
    );
    expect(res.statusCode).toBe(400);
    expect(repo.getWorkoutDayCounts).not.toHaveBeenCalled();
  });

  it('rejects malformed dates', async () => {
    const res = await request(app).get(
      '/v2/reports/workout-days?start=last-year&end=2026-09-24'
    );
    expect(res.statusCode).toBe(400);
  });
});
