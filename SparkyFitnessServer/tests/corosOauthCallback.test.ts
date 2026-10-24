import { vi, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error TS(7016): supertest ships no types in this workspace.
import request from 'supertest';
import express from 'express';
import { OAuthStateError } from '../utils/oauthState.js';

const OTHER_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const { identity, corosIntegration } = vi.hoisted(() => ({
  identity: { userId: '', authenticatedUserId: '', originalUserId: '' },
  corosIntegration: {
    getAuthorizationUrl: vi.fn(),
    exchangeCodeForTokens: vi.fn(),
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
      req.userId = identity.userId;
      req.authenticatedUserId = identity.authenticatedUserId;
      req.originalUserId = identity.originalUserId;
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
vi.mock('../services/corosService.js', () => ({ default: {} }));

const { default: corosRoutes } = await import('../routes/corosRoutes.js');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/integrations/coros', corosRoutes);
  return instance;
}

const validState = () => `${'a'.repeat(64)}.${Date.now()}`;

beforeEach(() => {
  vi.clearAllMocks();
  identity.userId = OTHER_USER_ID;
  identity.authenticatedUserId = OTHER_USER_ID;
  identity.originalUserId = OTHER_USER_ID;
  process.env.SPARKY_FITNESS_FRONTEND_URL = 'https://app.test';
});

describe('COROS callback state binding', () => {
  it('never passes a request-supplied user id to the exchange', async () => {
    corosIntegration.exchangeCodeForTokens.mockRejectedValue(
      new OAuthStateError('malformed', 'malformed')
    );

    const res = await request(app())
      .post('/api/integrations/coros/callback')
      .send({
        code: 'auth-code-123',
        state: validState(),
        userId: OWNER_ID,
      });

    expect(res.statusCode).toBe(400);
    expect(corosIntegration.exchangeCodeForTokens).toHaveBeenCalledWith(
      expect.any(String),
      'auth-code-123',
      expect.any(String),
      OTHER_USER_ID
    );
  });

  it('rejects swapped state nonces from another user', async () => {
    corosIntegration.exchangeCodeForTokens.mockRejectedValue(
      new OAuthStateError('unknown', 'Unknown or mismatched state')
    );

    const res = await request(app())
      .post('/api/integrations/coros/callback')
      .send({
        code: 'auth-code-123',
        state: validState(),
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Invalid or expired authorization state/i);
  });
});
