import { readFileSync } from 'node:fs';
import express from 'express';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'supertest'
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { passkeyLoginGuard } from '../middleware/passkeyLoginGuard.js';
import globalSettingsRepository from '../models/globalSettingsRepository.js';
import { log } from '../config/logging.js';

vi.mock('../auth.js', () => {
  const auth = { api: { getSession: vi.fn() }, options: {} };
  return {
    default: { auth },
    auth,
    cleanupSessions: vi.fn(),
    syncTrustedProviders: vi.fn(),
  };
});
vi.mock('../utils/bearerAuthBridge.js', () => ({
  bridgeBearerAuthHeader: vi.fn().mockResolvedValue({ apiKeyToken: null }),
}));
vi.mock('../models/globalSettingsRepository.js', () => ({
  default: { getGlobalSettings: vi.fn() },
}));
vi.mock('../models/oidcProviderRepository.js', () => ({
  default: { getOidcProviders: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

const getGlobalSettings = vi.mocked(globalSettingsRepository.getGlobalSettings);
const passkeyLogin = (enabled: boolean) =>
  getGlobalSettings.mockResolvedValue({
    enable_email_password_login: true,
    is_oidc_active: false,
    enable_passkey_login: enabled,
  });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('passkey login guard', () => {
  const app = express();
  app.use(passkeyLoginGuard);
  app.use((_req, res) => {
    res.sendStatus(204);
  });

  it.each([
    ['get', '/api/auth/passkey/generate-authenticate-options'],
    ['post', '/api/auth/passkey/verify-authentication'],
    ['get', '/api/auth/passkey/generate-register-options'],
    ['post', '/api/auth/passkey/verify-registration'],
    ['post', '/api/auth/passkey/verify-authentication/'],
  ] as const)(
    'blocks %s %s when passkey login is disabled',
    async (method, path) => {
      passkeyLogin(false);
      const response = await request(app)[method](path);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message: 'Passkey login is not enabled',
        code: 'PASSKEY_LOGIN_DISABLED',
      });
    }
  );

  it.each([
    ['get', '/api/auth/passkey/list-user-passkeys'],
    ['post', '/api/auth/passkey/delete-passkey'],
    ['post', '/api/auth/passkey/update-passkey'],
    ['post', '/api/auth/sign-in/email'],
  ] as const)(
    'leaves %s %s available while passkey login is disabled',
    async (method, path) => {
      passkeyLogin(false);
      expect((await request(app)[method](path)).status).toBe(204);
      expect(getGlobalSettings).not.toHaveBeenCalled();
    }
  );

  it('allows passkey sign-in when it is enabled', async () => {
    passkeyLogin(true);
    expect(
      (await request(app).post('/api/auth/passkey/verify-authentication'))
        .status
    ).toBe(204);
  });

  it.each([
    [undefined, 'true', 400],
    [undefined, undefined, 204],
    ['true', 'true', 204],
  ])(
    'falls back to the environment (FORCE=%s DISABLE=%s) when settings cannot be read',
    async (force, disable, status) => {
      vi.stubEnv('SPARKY_FITNESS_FORCE_PASSKEY_LOGIN', force);
      vi.stubEnv('SPARKY_FITNESS_DISABLE_PASSKEY_LOGIN', disable);
      getGlobalSettings.mockRejectedValue(new Error('database away'));
      expect(
        (await request(app).post('/api/auth/passkey/verify-authentication'))
          .status
      ).toBe(status);
      expect(log).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('Could not read login settings'),
        expect.any(Error)
      );
    }
  );
});

describe('login settings', () => {
  const app = express();
  beforeAll(async () => {
    const { default: router } =
      await import('../routes/auth/authCoreRoutes.js');
    app.use('/api/auth', router);
  });

  it.each([true, false])(
    'reports passkey.enabled=%s from the effective setting',
    async (enabled) => {
      passkeyLogin(enabled);
      const response = await request(app).get('/api/auth/settings');
      expect(response.status).toBe(200);
      expect(response.body.passkey).toEqual({ enabled });
    }
  );

  it('falls back to the environment when the saved settings cannot be read', async () => {
    vi.stubEnv('SPARKY_FITNESS_DISABLE_PASSKEY_LOGIN', 'true');
    getGlobalSettings.mockRejectedValue(new Error('database away'));
    const response = await request(app).get('/api/auth/settings');
    expect(response.body.passkey).toEqual({ enabled: false });
  });
});

// The server boots on import, so check its middleware order without starting it.
it('mounts the passkey guard before forwarding requests to Better Auth', () => {
  const source = readFileSync(
    new URL('../SparkyFitnessServer.ts', import.meta.url),
    'utf8'
  );
  const guardAt = source.indexOf('app.use(passkeyLoginGuard)');
  const forwardingAt = source.indexOf(
    'return betterAuthHandlerInstance(req, res)'
  );
  expect(guardAt).toBeGreaterThan(-1);
  expect(guardAt).toBeLessThan(forwardingAt);
});
