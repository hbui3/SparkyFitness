import { vi, beforeEach, describe, expect, it } from 'vitest';
import axios from 'axios';
import { getSystemClient } from '../db/poolManager.js';
import { encrypt, decrypt } from '../security/encryption.js';
import {
  refreshAccessToken,
  CorosReauthRequiredError,
} from '../integrations/coros/corosService.js';

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../utils/diagnosticLogger.js', () => ({ logRawResponse: vi.fn() }));
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    isAxiosError: (e: { isAxiosError?: boolean }) => !!e?.isAxiosError,
  },
}));
vi.mock('../db/poolManager.js', () => ({ getSystemClient: vi.fn() }));
vi.mock('../security/encryption.js', () => ({
  ENCRYPTION_KEY: 'test-key',
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}));

function mockClient() {
  const client = {
    // Values are irrelevant because decrypt is stubbed; the stored client id
    // and refresh token only have to be present.
    query: vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'provider-1',
          base_url: null,
          encrypted_app_id: 'a',
          app_id_iv: 'b',
          app_id_tag: 'c',
          encrypted_refresh_token: 'd',
          refresh_token_iv: 'e',
          refresh_token_tag: 'f',
        },
      ],
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

describe('COROS token refresh', () => {
  it('locks the provider row and saves the new tokens in one transaction', async () => {
    const client = mockClient();
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 2591999,
      },
    });

    await expect(refreshAccessToken('user-1', 'provider-1')).resolves.toBe(
      'new-access'
    );

    expect(statements(client)).toEqual(['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
    expect(client.query.mock.calls[1][0]).toMatch(/FOR UPDATE/);
    expect(client.release).toHaveBeenCalled();
  });

  it('still clears the tokens when COROS rejects the refresh token', async () => {
    const client = mockClient();
    vi.mocked(axios.post).mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { error: 'invalid_grant' } },
    });

    await expect(
      refreshAccessToken('user-1', 'provider-1')
    ).rejects.toBeInstanceOf(CorosReauthRequiredError);

    // The clearing UPDATE is committed, not rolled back with the lock.
    expect(statements(client)).toEqual(['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
    expect(client.query.mock.calls[2][0]).toMatch(
      /encrypted_refresh_token = NULL/
    );
    expect(client.release).toHaveBeenCalled();
  });
});
