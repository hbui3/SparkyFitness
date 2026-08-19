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

vi.mock('../integrations/igpsport/igpsportService.js', () => ({
  default: {
    syncIGPSportData: vi.fn(),
    getIGPSportStatus: vi.fn(),
  },
}));

import igpsportRoutes from '../routes/igpsportRoutes.js';
import igpsportService from '../integrations/igpsport/igpsportService.js';

const app = express();
app.use(express.json());
app.use('/api/integrations/igpsport', igpsportRoutes);

describe('iGPSPORT routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects an incomplete date range', async () => {
    const response = await request(app)
      .post('/api/integrations/igpsport/sync')
      .send({ startDate: '2026-08-01' });

    expect(response.status).toBe(400);
    expect(igpsportService.syncIGPSportData).not.toHaveBeenCalled();
  });

  it('returns the validated import counts', async () => {
    vi.mocked(igpsportService.syncIGPSportData).mockResolvedValue({
      success: true,
      createdActivities: 2,
      updatedActivities: 1,
      failedActivities: 0,
      startDate: '2026-08-01',
      endDate: '2026-08-18',
    });

    const response = await request(app)
      .post('/api/integrations/igpsport/sync')
      .send({ startDate: '2026-08-01', endDate: '2026-08-18' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      createdActivities: 2,
      updatedActivities: 1,
      failedActivities: 0,
    });
  });
});
