import { beforeEach, describe, expect, it, vi } from 'vitest';

// Better Auth's own routes (/api/auth/*) skip `authenticate`, so the early
// interceptor asks this guard before handing a mutation to Better Auth (#2678).
const { mockGetSession, mockGetApiKeyPermissions } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetApiKeyPermissions: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  auth: { api: { getSession: mockGetSession } },
}));
vi.mock('../models/apiKeyRepository.js', () => ({
  getApiKeyPermissions: mockGetApiKeyPermissions,
  default: { getApiKeyPermissions: mockGetApiKeyPermissions },
}));

import { isReadOnlyApiKeyAuthMutation } from '../middleware/readOnlyApiKeyGuard.js';

const KEY_HEADERS = { 'x-api-key': 'k'.repeat(64) };

describe('isReadOnlyApiKeyAuthMutation (#2678)', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetApiKeyPermissions.mockReset();
    mockGetSession.mockResolvedValue({
      user: { id: 'u1' },
      session: { id: 'key-1' },
    });
    mockGetApiKeyPermissions.mockResolvedValue('{"sparky":["read"]}');
  });

  it('blocks a read-only key creating another key', async () => {
    await expect(
      isReadOnlyApiKeyAuthMutation({ method: 'POST', headers: KEY_HEADERS })
    ).resolves.toBe(true);
  });

  it('lets a read-only key read', async () => {
    await expect(
      isReadOnlyApiKeyAuthMutation({ method: 'GET', headers: KEY_HEADERS })
    ).resolves.toBe(false);
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('lets a full-access key through', async () => {
    mockGetApiKeyPermissions.mockResolvedValue(null);
    await expect(
      isReadOnlyApiKeyAuthMutation({ method: 'POST', headers: KEY_HEADERS })
    ).resolves.toBe(false);
  });

  it('ignores requests without an API key', async () => {
    await expect(
      isReadOnlyApiKeyAuthMutation({ method: 'POST', headers: {} })
    ).resolves.toBe(false);
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('leaves an invalid key to Better Auth', async () => {
    mockGetSession.mockRejectedValue(new Error('INVALID_API_KEY'));
    await expect(
      isReadOnlyApiKeyAuthMutation({ method: 'POST', headers: KEY_HEADERS })
    ).resolves.toBe(false);
  });
});
