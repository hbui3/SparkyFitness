import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error TS(7016): no types for supertest
import request from 'supertest';
import express from 'express';

// "Sync now" for providers whose routes have no other sync tests: each claims
// the account first and answers 409 without syncing when another sync holds it.

vi.mock('../middleware/authMiddleware.js', () => ({
  default: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authenticate: (req: any, _res: any, next: any) => {
      req.userId = 'user-1';
      req.authenticatedUserId = 'user-1';
      next();
    },
  },
}));
vi.mock('../middleware/checkPermissionMiddleware.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../models/globalSettingsRepository.js', () => ({
  isMockDataEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock('../utils/oauthState.js', () => ({}));
vi.mock('../integrations/fitbit/fitbitService.js', () => ({ default: {} }));
vi.mock('../integrations/polar/polarService.js', () => ({ default: {} }));
vi.mock('../integrations/strava/stravaService.js', () => ({ default: {} }));
vi.mock('../integrations/withings/withingsService.js', () => ({ default: {} }));
vi.mock('../services/fitbitService.js', () => ({
  default: { syncFitbitData: vi.fn() },
}));
vi.mock('../services/polarService.js', () => ({
  default: { syncPolarData: vi.fn() },
}));
vi.mock('../services/stravaService.js', () => ({
  default: { syncStravaData: vi.fn() },
}));
vi.mock('../services/withingsService.js', () => ({
  default: { syncWithingsData: vi.fn() },
}));
vi.mock('../integrations/hevy/hevyService.js', () => ({
  default: { syncHevyData: vi.fn() },
}));
vi.mock('../services/providerSyncClaim.js', async (importActual) => ({
  ...(await importActual<typeof import('../services/providerSyncClaim.js')>()),
  startProviderSync: vi.fn(),
}));

import fitbitRoutes from '../routes/fitbitRoutes.js';
import polarRoutes from '../routes/polarRoutes.js';
import stravaRoutes from '../routes/stravaRoutes.js';
import withingsRoutes from '../routes/withingsRoutes.js';
import hevyRoutes from '../routes/hevyRoutes.js';
import fitbitService from '../services/fitbitService.js';
import polarService from '../services/polarService.js';
import stravaService from '../services/stravaService.js';
import withingsService from '../services/withingsService.js';
import hevyService from '../integrations/hevy/hevyService.js';
import {
  SYNC_ALREADY_RUNNING_RESPONSE,
  startProviderSync,
} from '../services/providerSyncClaim.js';

const app = express();
app.use(express.json());
app.use('/fitbit', fitbitRoutes);
app.use('/polar', polarRoutes);
app.use('/strava', stravaRoutes);
app.use('/withings', withingsRoutes);
app.use('/hevy', hevyRoutes);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(startProviderSync).mockResolvedValue(null);
});

describe('manual sync while another sync holds the account', () => {
  it.each([
    {
      path: '/fitbit/sync',
      body: {},
      sync: () => fitbitService.syncFitbitData,
      target: { userId: 'user-1', providerType: 'fitbit' },
    },
    {
      path: '/polar/sync',
      body: { providerId: 'polar-1' },
      sync: () => polarService.syncPolarData,
      target: { userId: 'user-1', providerId: 'polar-1' },
    },
    {
      path: '/strava/sync',
      body: {},
      sync: () => stravaService.syncStravaData,
      target: { userId: 'user-1', providerType: 'strava' },
    },
    {
      path: '/withings/sync',
      body: {},
      sync: () => withingsService.syncWithingsData,
      target: { userId: 'user-1', providerType: 'withings' },
    },
    {
      path: '/hevy/sync',
      body: {},
      sync: () => hevyService.syncHevyData,
      target: { userId: 'user-1', providerType: 'hevy' },
    },
  ])(
    '$path answers 409 without syncing',
    async ({ path, body, sync, target }) => {
      const res = await request(app).post(path).send(body);

      expect(res.statusCode).toBe(409);
      expect(res.body).toEqual(SYNC_ALREADY_RUNNING_RESPONSE);
      expect(startProviderSync).toHaveBeenCalledWith(
        target,
        expect.any(Function)
      );
      expect(sync()).not.toHaveBeenCalled();
    }
  );
});
