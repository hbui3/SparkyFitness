import { vi, beforeEach, describe, expect, it } from 'vitest';
import { getClient } from '../db/poolManager.js';
import { decrypt } from '../security/encryption.js';
import { replaceGarminTokensIfUnchanged } from '../models/externalProviderRepository.js';

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../db/poolManager.js', () => ({
  getClient: vi.fn(),
  getSystemClient: vi.fn(),
}));
vi.mock('../security/encryption.js', () => ({
  ENCRYPTION_KEY: 'test-key',
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}));

const UPDATE = {
  encrypted_garth_dump: 'enc-new',
  garth_dump_iv: 'iv',
  garth_dump_tag: 'tag',
  token_expires_at: null,
  external_user_id: 'garmin-guid',
};

function mockClient(rows: Array<Record<string, string>>) {
  const client = {
    query: vi
      .fn()
      .mockImplementation(async (sql: string) =>
        sql.trim().startsWith('SELECT') ? { rows } : { rows: [] }
      ),
    release: vi.fn(),
  };
  vi.mocked(getClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof getClient>>
  );
  return client;
}

// First keyword of each statement sent, e.g. ['BEGIN', 'SELECT', 'COMMIT'].
function statements(client: ReturnType<typeof mockClient>) {
  return client.query.mock.calls.map(([sql]) => sql.trim().split(/\s+/)[0]);
}

const STORED_ROW = {
  id: 'provider-1',
  encrypted_garth_dump: 'enc-old',
  garth_dump_iv: 'iv-old',
  garth_dump_tag: 'tag-old',
};

beforeEach(() => vi.clearAllMocks());

describe('replaceGarminTokensIfUnchanged', () => {
  it('saves the refreshed tokens while the stored ones are those the request sent', async () => {
    const client = mockClient([STORED_ROW]);
    vi.mocked(decrypt).mockResolvedValue('sent-tokens');

    await expect(
      replaceGarminTokensIfUnchanged('user-1', 'sent-tokens', UPDATE)
    ).resolves.toBe(true);

    expect(statements(client)).toEqual(['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
    expect(client.query.mock.calls[1][0]).toMatch(/FOR UPDATE/);
    expect(client.query.mock.calls[2][1]).toEqual([
      'enc-new',
      'iv',
      'tag',
      null,
      'garmin-guid',
      'provider-1',
    ]);
    expect(client.release).toHaveBeenCalled();
  });

  it('keeps newer tokens that were saved after the request was sent', async () => {
    const client = mockClient([STORED_ROW]);
    vi.mocked(decrypt).mockResolvedValue('newer-tokens');

    await expect(
      replaceGarminTokensIfUnchanged('user-1', 'sent-tokens', UPDATE)
    ).resolves.toBe(false);

    expect(statements(client)).toEqual(['BEGIN', 'SELECT', 'COMMIT']);
    expect(client.release).toHaveBeenCalled();
  });

  it('saves nothing when no Garmin tokens are stored', async () => {
    const client = mockClient([]);

    await expect(
      replaceGarminTokensIfUnchanged('user-1', 'sent-tokens', UPDATE)
    ).resolves.toBe(false);

    expect(statements(client)).toEqual(['BEGIN', 'SELECT', 'COMMIT']);
    expect(decrypt).not.toHaveBeenCalled();
  });
});
