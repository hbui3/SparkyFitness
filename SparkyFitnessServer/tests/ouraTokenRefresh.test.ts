import { vi, beforeEach, describe, expect, it } from 'vitest';
import axios from 'axios';
import { getSystemClient } from '../db/poolManager.js';
import { encrypt, decrypt } from '../security/encryption.js';
import ouraService from '../integrations/oura/ouraService.js';

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../utils/diagnosticLogger.js', () => ({ logRawResponse: vi.fn() }));
vi.mock('axios', () => ({ default: { post: vi.fn() } }));
vi.mock('../db/poolManager.js', () => ({ getSystemClient: vi.fn() }));
vi.mock('../security/encryption.js', () => ({
  ENCRYPTION_KEY: 'test-key',
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}));

function mockClient() {
  const client = {
    // Values are irrelevant because decrypt is stubbed, but the refresh
    // requires a stored refresh token.
    query: vi.fn().mockResolvedValue({
      rows: [{ encrypted_refresh_token: 'g' }],
      rowCount: 1,
    }),
    release: vi.fn(),
  };
  vi.mocked(getSystemClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof getSystemClient>>
  );
  return client;
}

// First keyword of each statement the refresh sent, e.g. ['BEGIN', 'SELECT', 'COMMIT'].
function statements(client: ReturnType<typeof mockClient>) {
  return client.query.mock.calls.map(([sql]) => sql.trim().split(/\s+/)[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(decrypt).mockResolvedValue('decrypted-value');
  vi.mocked(encrypt).mockResolvedValue({
    encryptedText: 'enc',
    iv: 'iv',
    tag: 'tag',
  });
});

describe('Oura token refresh', () => {
  it('locks the provider row and saves the new tokens in one transaction', async () => {
    const client = mockClient();
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 86400,
        scope: 'daily',
      },
    });

    await expect(ouraService.refreshAccessToken('user-1')).resolves.toBe(
      'new-access'
    );

    expect(statements(client)).toEqual(['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
    expect(client.query.mock.calls[1][0]).toMatch(/FOR UPDATE/);
    expect(client.release).toHaveBeenCalled();
  });

  it('releases the lock when Oura rejects the refresh', async () => {
    const client = mockClient();
    vi.mocked(axios.post).mockRejectedValue(new Error('invalid_grant'));

    await expect(ouraService.refreshAccessToken('user-1')).rejects.toThrow(
      'invalid_grant'
    );

    expect(statements(client)).toEqual(['BEGIN', 'SELECT', 'COMMIT']);
    expect(client.release).toHaveBeenCalled();
  });
});
