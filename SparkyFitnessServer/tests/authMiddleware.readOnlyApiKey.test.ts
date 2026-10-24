import { vi, beforeEach, describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

// Read-only API keys (issue #2678): authenticate refuses everything but reads
// and a short allowlist of non-mutating POSTs.
const { mockGetSession, mockGetApiKeyPermissions } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetApiKeyPermissions: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  auth: {
    api: { getSession: mockGetSession },
    options: {
      advanced: { cookiePrefix: 'sparky', useSecureCookies: false },
      secret: 'test-secret',
    },
  },
}));

vi.mock('../models/apiKeyRepository.js', () => ({
  getApiKeyPermissions: mockGetApiKeyPermissions,
  default: { getApiKeyPermissions: mockGetApiKeyPermissions },
}));

vi.mock('../models/userRepository.js', () => ({
  default: {
    ensureUserInitialization: vi.fn().mockResolvedValue(undefined),
    getUserRole: vi.fn().mockResolvedValue('user'),
    updateUserLastLogin: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../utils/permissionUtils.js', () => ({
  canAccessUserData: vi.fn().mockResolvedValue(false),
}));

vi.mock('../config/logging.js', () => ({
  log: vi.fn(),
}));

vi.mock('better-call', () => ({
  serializeSignedCookie: vi.fn().mockResolvedValue('cookie-value'),
}));

import { authenticate } from '../middleware/authMiddleware.js';
import { clearApiKeySessionCache } from '../utils/apiKeySessionCache.js';

const API_KEY = 'k'.repeat(64);
const READ_ONLY = JSON.stringify({ sparky: ['read'] });
const FULL = JSON.stringify({ sparky: ['read', 'write'] });

interface FakeRes {
  statusCode: number | null;
  body: unknown;
  status: (code: number) => FakeRes;
  json: (body: unknown) => FakeRes;
  set: () => FakeRes;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
    set() {
      return res;
    },
  };
  return res;
}

function makeReq(
  method: string,
  originalUrl: string,
  headers: Record<string, string> = { authorization: `Bearer ${API_KEY}` }
) {
  return {
    method,
    originalUrl,
    path: originalUrl.split('?')[0],
    headers: { ...headers },
    cookies: {},
  } as unknown as Request & { apiKeyReadOnly?: boolean };
}

async function run(
  method: string,
  url: string,
  headers?: Record<string, string>
) {
  const req = makeReq(method, url, headers);
  const res = makeRes();
  const next = vi.fn();
  await authenticate(
    req,
    res as unknown as Response,
    next as unknown as NextFunction
  );
  return { req, res, next };
}

describe('authenticate: read-only API keys (#2678)', () => {
  beforeEach(() => {
    clearApiKeySessionCache();
    mockGetSession.mockReset();
    mockGetApiKeyPermissions.mockReset();
    mockGetSession.mockResolvedValue({
      user: { id: 'u1', name: 'U' },
      session: { id: 'key-1' },
    });
  });

  describe('with a read-only key', () => {
    beforeEach(() => {
      mockGetApiKeyPermissions.mockResolvedValue(READ_ONLY);
    });

    it('allows GET requests and marks the request', async () => {
      const { req, res, next } = await run('GET', '/api/foods?search=x');
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBeNull();
      expect(req.apiKeyReadOnly).toBe(true);
      expect(mockGetApiKeyPermissions).toHaveBeenCalledWith('u1', 'key-1');
    });

    it.each(['PUT', 'PATCH', 'DELETE'])('refuses %s with 403', async (m) => {
      const { res, next } = await run(m, '/api/food-entries/123');
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: 'This API key is read-only.' });
    });

    it('refuses a POST outside the allowlist', async () => {
      const { res, next } = await run('POST', '/api/food-entries');
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    it.each(['/mcp', '/mcp/', '/api/ai/convert-unit', '/api/foods/scan-label'])(
      'allows the non-mutating POST %s',
      async (url) => {
        const { res, next } = await run('POST', url);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBeNull();
      }
    );

    it('does not treat an allowlisted path as a prefix', async () => {
      const { res, next } = await run('POST', '/api/foods/scan-label/extra');
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    it('keeps refusing writes when the session comes from the cache', async () => {
      await run('GET', '/api/foods');
      const { res, next } = await run('DELETE', '/api/foods/1');
      expect(mockGetSession).toHaveBeenCalledTimes(1);
      expect(mockGetApiKeyPermissions).toHaveBeenCalledTimes(1);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });
  });

  it('gives a key without permissions full access (existing keys)', async () => {
    mockGetApiKeyPermissions.mockResolvedValue(null);
    const { req, res, next } = await run('DELETE', '/api/food-entries/1');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
    expect(req.apiKeyReadOnly).toBe(false);
  });

  it('gives a key with read and write full access', async () => {
    mockGetApiKeyPermissions.mockResolvedValue(FULL);
    const { next } = await run('POST', '/api/food-entries');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the key cannot be found', async () => {
    mockGetApiKeyPermissions.mockResolvedValue(undefined);
    const { res, next } = await run('POST', '/api/food-entries');
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('never looks up a scope for session-cookie requests', async () => {
    const { req, next } = await run('DELETE', '/api/food-entries/1', {});
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockGetApiKeyPermissions).not.toHaveBeenCalled();
    expect(req.apiKeyReadOnly).toBe(false);
  });
});
