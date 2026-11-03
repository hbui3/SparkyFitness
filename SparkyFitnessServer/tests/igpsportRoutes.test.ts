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
import { IGPSportApiError } from '../integrations/igpsport/igpsportApiClient.js';

const app = express();
app.use(express.json());
app.use('/api/integrations/igpsport', igpsportRoutes);

describe('iGPSPORT routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hides system details in a provider 502 response', async () => {
    const error = Object.assign(
      new IGPSportApiError('getaddrinfo ENOTFOUND private.igpsport.internal'),
      {
        code: 'ENOTFOUND',
        errno: -3008,
        syscall: 'getaddrinfo',
      }
    );
    vi.mocked(igpsportService.syncIGPSportData).mockRejectedValue(error);

    const response = await request(app)
      .post('/api/integrations/igpsport/sync')
      .send({});

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ message: 'iGPSPORT sync failed.' });
  });

  it('preserves actionable noninternal provider messages', async () => {
    vi.mocked(igpsportService.syncIGPSportData).mockRejectedValue(
      new IGPSportApiError('iGPSPORT FIT file exceeds the 50MB limit.')
    );

    const response = await request(app)
      .post('/api/integrations/igpsport/sync')
      .send({});

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      message: 'iGPSPORT FIT file exceeds the 50MB limit.',
    });
  });

  it('hides database details in status failures', async () => {
    vi.mocked(igpsportService.getIGPSportStatus).mockRejectedValue(
      Object.assign(
        new Error('relation "private_provider_tokens" does not exist'),
        {
          code: '42P01',
          severity: 'ERROR',
        }
      )
    );

    const response = await request(app).get(
      '/api/integrations/igpsport/status'
    );

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      message: 'Unable to read iGPSPORT status.',
    });
  });

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
