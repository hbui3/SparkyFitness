import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
// @ts-expect-error TS(7016): supertest has no declaration in this workspace.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/authMiddleware.js', () => ({
  default: {
    authenticate: (req: Request, _res: Response, next: NextFunction) => {
      req.userId = '11111111-1111-4111-8111-111111111111';
      req.authenticatedUserId = req.userId;
      next();
    },
  },
}));

vi.mock('../integrations/speediance/speedianceService.js', () => ({
  default: {
    syncSpeedianceData: vi.fn(),
    getSpeedianceStatus: vi.fn(),
  },
}));

import speedianceRoutes from '../routes/speedianceRoutes.js';
import speedianceService from '../integrations/speediance/speedianceService.js';

const app = express();
app.use(express.json());
app.use('/api/integrations/speediance', speedianceRoutes);

describe('Speediance routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects an incomplete date range', async () => {
    const response = await request(app)
      .post('/api/integrations/speediance/sync')
      .send({ startDate: '2026-08-01' });

    expect(response.status).toBe(400);
    expect(speedianceService.syncSpeedianceData).not.toHaveBeenCalled();
  });

  it('returns the validated sync result', async () => {
    vi.mocked(speedianceService.syncSpeedianceData).mockResolvedValue({
      success: true,
      importedWorkouts: 2,
      importedExercises: 8,
      skippedWorkouts: 0,
      startDate: '2026-08-01',
      endDate: '2026-08-18',
    });

    const response = await request(app)
      .post('/api/integrations/speediance/sync')
      .send({ startDate: '2026-08-01', endDate: '2026-08-18' });

    expect(response.status).toBe(200);
    expect(response.body.importedExercises).toBe(8);
  });
});
