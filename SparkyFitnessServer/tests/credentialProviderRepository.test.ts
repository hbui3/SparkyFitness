import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient } from '../db/poolManager.js';
import { decrypt } from '../security/encryption.js';

vi.mock('../db/poolManager.js', () => ({ getClient: vi.fn() }));
vi.mock('../security/encryption.js', () => ({
  decrypt: vi.fn(),
  ENCRYPTION_KEY: 'test-key',
}));

import {
  getCredentialProviderStatus,
  getCredentialProviderValues,
  updateCredentialProviderLastSync,
} from '../integrations/credentialProviderRepository.js';

const providerRow = {
  id: '11111111-1111-4111-8111-111111111111',
  is_active: true,
  base_url: 'https://prod.en.igpsport.com',
  last_sync_at: '2026-08-18T08:00:00.000Z',
  encrypted_app_id: 'encrypted-account',
  app_id_iv: 'account-iv',
  app_id_tag: 'account-tag',
  encrypted_app_key: 'encrypted-password',
  app_key_iv: 'password-iv',
  app_key_tag: 'password-tag',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('credentialProviderRepository', () => {
  it('loads and decrypts an active owner-scoped provider', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [providerRow] }),
      release: vi.fn(),
    };
    vi.mocked(getClient).mockResolvedValue(mockClient as never);
    vi.mocked(decrypt)
      .mockResolvedValueOnce('rider@example.com')
      .mockResolvedValueOnce('local-password');

    const credentials = await getCredentialProviderValues({
      userId: 'user-1',
      providerType: 'igpsport',
      providerDisplayName: 'iGPSPORT',
      providerId: providerRow.id,
      usernameLabel: 'account',
    });

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE user_id = $1'),
      ['user-1', 'igpsport', providerRow.id]
    );
    expect(credentials).toMatchObject({
      providerId: providerRow.id,
      username: 'rider@example.com',
      password: 'local-password',
      baseUrl: 'https://prod.en.igpsport.com',
      lastSyncAt: expect.any(Date),
    });
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('reports credential presence without decrypting secrets', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [providerRow] }),
      release: vi.fn(),
    };
    vi.mocked(getClient).mockResolvedValue(mockClient as never);

    const status = await getCredentialProviderStatus(
      'user-1',
      'igpsport',
      providerRow.id
    );

    expect(status).toMatchObject({ connected: true, active: true });
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('returns a disconnected status when the owner has no matching provider', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    vi.mocked(getClient).mockResolvedValue(mockClient as never);

    await expect(
      getCredentialProviderStatus('user-1', 'igpsport')
    ).resolves.toEqual({
      connected: false,
      active: false,
      baseUrl: null,
      lastSyncAt: null,
    });
  });

  it('updates last_sync_at only for the owner and provider type', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rowCount: 1 }),
      release: vi.fn(),
    };
    vi.mocked(getClient).mockResolvedValue(mockClient as never);
    const lastSyncAt = new Date('2026-08-19T08:00:00.000Z');

    await updateCredentialProviderLastSync(
      'user-1',
      'igpsport',
      providerRow.id,
      lastSyncAt
    );

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'WHERE id = $2 AND user_id = $3 AND provider_type = $4'
      ),
      [lastSyncAt, providerRow.id, 'user-1', 'igpsport']
    );
  });
});
