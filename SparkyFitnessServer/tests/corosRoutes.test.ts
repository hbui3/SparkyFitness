import { vi, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error TS(7016): supertest ships no types in this workspace.
import request from 'supertest';
import express from 'express';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const { corosIntegration, corosSyncService } = vi.hoisted(() => ({
  corosIntegration: {
    getAuthorizationUrl: vi.fn(),
    exchangeCodeForTokens: vi.fn(),
    disconnectCoros: vi.fn(),
    getStatus: vi.fn(),
  },
  corosSyncService: {
    syncCorosData: vi.fn(),
  },
}));

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../middleware/authMiddleware.js', () => ({
  default: {
    authenticate: (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction
    ) => {
      req.userId = USER_ID;
      req.authenticatedUserId = USER_ID;
      req.originalUserId = USER_ID;
      next();
    },
  },
}));
vi.mock('../middleware/checkPermissionMiddleware.js', () => ({
  default:
    () =>
    (
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction
    ) =>
      next(),
}));
vi.mock('../integrations/coros/corosService.js', () => ({
  default: corosIntegration,
  getCorosRedirectUri: () => 'https://app.test/coros/callback',
}));
vi.mock('../services/corosService.js', () => ({
  default: corosSyncService,
}));
vi.mock('../utils/mockDataOptions.js', () => ({
  resolveMockDataOptions: vi.fn(async () => ({
    dataSource: undefined,
    saveMockData: false,
  })),
}));

const { default: corosRoutes } = await import('../routes/corosRoutes.js');

vi.mock('../services/providerSyncClaim.js', async (importActual) => ({
  ...(await importActual<typeof import('../services/providerSyncClaim.js')>()),
  startProviderSync: vi.fn(async (_target, sync) => ({ running: sync() })),
}));
import {
  SYNC_ALREADY_RUNNING_RESPONSE,
  startProviderSync,
} from '../services/providerSyncClaim.js';

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/integrations/coros', corosRoutes);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('COROS routes', () => {
  it('GET /authorize returns auth url', async () => {
    corosIntegration.getAuthorizationUrl.mockResolvedValue(
      'https://mcpus.coros.com/connect/authorize?client_id=123'
    );

    const res = await request(app()).get('/api/integrations/coros/authorize');
    expect(res.statusCode).toBe(200);
    expect(res.body.authUrl).toContain('mcpus.coros.com');
  });

  it('answers 409 without syncing while another sync holds the account', async () => {
    vi.mocked(startProviderSync).mockResolvedValueOnce(null);

    const res = await request(app())
      .post('/api/integrations/coros/sync')
      .send({});

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual(SYNC_ALREADY_RUNNING_RESPONSE);
    expect(startProviderSync).toHaveBeenCalledWith(
      { userId: USER_ID, providerType: 'coros_mcp' },
      expect.any(Function)
    );
    expect(corosSyncService.syncCorosData).not.toHaveBeenCalled();
  });

  it('POST /sync triggers sync and returns stats', async () => {
    corosSyncService.syncCorosData.mockResolvedValue({
      success: true,
      workoutsImported: 3,
      measurementsImported: 0,
      errors: [],
    });

    const res = await request(app()).post('/api/integrations/coros/sync').send({
      startDate: '2026-09-01',
      endDate: '2026-09-27',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.workoutsImported).toBe(3);
  });

  it('POST /disconnect disconnects account', async () => {
    corosIntegration.disconnectCoros.mockResolvedValue(undefined);

    const res = await request(app())
      .post('/api/integrations/coros/disconnect')
      .send({});
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toContain('disconnected successfully');
  });

  it('GET /status returns connection status', async () => {
    corosIntegration.getStatus.mockResolvedValue({
      connected: true,
      lastSync: '2026-09-27T12:00:00Z',
    });

    const res = await request(app()).get('/api/integrations/coros/status');
    expect(res.statusCode).toBe(200);
    expect(res.body.connected).toBe(true);
  });
});
