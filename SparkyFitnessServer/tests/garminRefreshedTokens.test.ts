import { vi, beforeEach, describe, expect, it } from 'vitest';
import externalProviderRepository from '../models/externalProviderRepository.js';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('axios', () => ({
  default: { create: () => ({ post }), isAxiosError: () => false },
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../security/encryption.js', () => ({
  ENCRYPTION_KEY: 'test-key',
  encrypt: vi.fn().mockResolvedValue({
    encryptedText: 'enc-new',
    iv: 'iv',
    tag: 'tag',
  }),
  decrypt: vi.fn(),
}));
vi.mock('../models/externalProviderRepository.js', () => ({
  default: {
    getExternalDataProviderByUserIdAndProviderName: vi.fn(),
    replaceGarminTokensIfUnchanged: vi.fn(),
    updateExternalDataProvider: vi.fn(),
    createExternalDataProvider: vi.fn(),
  },
}));

const { default: garminConnectService } =
  await import('../integrations/garminconnect/garminConnectService.js');

// A di_token whose payload carries an expiry and a Garmin user id.
const payload = Buffer.from(
  JSON.stringify({ exp: 1790000000, garmin_guid: 'garmin-guid' })
).toString('base64');
const NEW_TOKENS = { di_token: `x.${payload}.y`, di_client_id: 'c' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(
    externalProviderRepository.getExternalDataProviderByUserIdAndProviderName
  ).mockResolvedValue({ id: 'provider-1', garth_dump: 'sent-tokens' } as never);
  post.mockResolvedValue({ data: { data: {}, new_tokens: NEW_TOKENS } });
});

describe('Garmin tokens refreshed during a sync request', () => {
  it('are saved only if the stored tokens are still the ones the request sent', async () => {
    vi.mocked(
      externalProviderRepository.replaceGarminTokensIfUnchanged
    ).mockResolvedValue(true);

    await garminConnectService.fetchGarminHealthAndWellnessChunk(
      'user-1',
      '2026-09-01',
      '2026-09-07'
    );

    expect(
      externalProviderRepository.replaceGarminTokensIfUnchanged
    ).toHaveBeenCalledWith(
      'user-1',
      'sent-tokens',
      expect.objectContaining({
        encrypted_garth_dump: 'enc-new',
        external_user_id: 'garmin-guid',
        token_expires_at: new Date(1790000000 * 1000),
      })
    );
    expect(
      externalProviderRepository.updateExternalDataProvider
    ).not.toHaveBeenCalled();
  });

  it('still returns the data when newer tokens were already saved', async () => {
    vi.mocked(
      externalProviderRepository.replaceGarminTokensIfUnchanged
    ).mockResolvedValue(false);

    await expect(
      garminConnectService.fetchGarminHealthAndWellnessChunk(
        'user-1',
        '2026-09-01',
        '2026-09-07'
      )
    ).resolves.toMatchObject({ data: {} });
  });
});
