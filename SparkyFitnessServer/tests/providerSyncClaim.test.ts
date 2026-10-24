import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import externalProviderRepository from '../models/externalProviderRepository.js';
import { log } from '../config/logging.js';
import {
  SYNC_CLAIM_EXPIRY_MINUTES,
  SYNC_CLAIM_RENEW_MINUTES,
  startProviderSync,
} from '../services/providerSyncClaim.js';

vi.mock('../models/externalProviderRepository.js', () => ({
  default: {
    claimProviderSyncRows: vi.fn(),
    releaseProviderSyncRows: vi.fn(),
    renewProviderSyncRows: vi.fn(),
  },
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

const target = { userId: 'user-1', providerType: 'garmin' };

describe('startProviderSync', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(
      externalProviderRepository.releaseProviderSyncRows
    ).mockResolvedValue();
  });

  it('runs the sync and releases the claim it made', async () => {
    vi.mocked(
      externalProviderRepository.claimProviderSyncRows
    ).mockResolvedValue({
      matched: 1,
      claimedIds: ['p1'],
    });

    const started = await startProviderSync(target, async () => 'synced');

    expect(await started?.running).toBe('synced');
    const [, claimedAt, expiry] = vi.mocked(
      externalProviderRepository.claimProviderSyncRows
    ).mock.calls[0];
    expect(expiry).toBe(SYNC_CLAIM_EXPIRY_MINUTES);
    expect(
      externalProviderRepository.releaseProviderSyncRows
    ).toHaveBeenCalledWith(['p1'], claimedAt);
  });

  it('returns before the sync finishes and holds the claim until it does', async () => {
    vi.mocked(
      externalProviderRepository.claimProviderSyncRows
    ).mockResolvedValue({
      matched: 1,
      claimedIds: ['p1'],
    });
    let finish = (_value: string) => {};
    const sync = () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      });

    const started = await startProviderSync(target, sync);

    expect(started).not.toBeNull();
    expect(
      externalProviderRepository.releaseProviderSyncRows
    ).not.toHaveBeenCalled();
    finish('synced');
    expect(await started!.running).toBe('synced');
    expect(
      externalProviderRepository.releaseProviderSyncRows
    ).toHaveBeenCalledOnce();
  });

  it('skips the sync when another sync holds the account', async () => {
    vi.mocked(
      externalProviderRepository.claimProviderSyncRows
    ).mockResolvedValue({
      matched: 1,
      claimedIds: [],
    });
    const sync = vi.fn();

    expect(await startProviderSync(target, sync)).toBeNull();
    expect(sync).not.toHaveBeenCalled();
  });

  it('gives back a partial claim and skips', async () => {
    vi.mocked(
      externalProviderRepository.claimProviderSyncRows
    ).mockResolvedValue({
      matched: 2,
      claimedIds: ['p1'],
    });
    const sync = vi.fn();

    expect(await startProviderSync(target, sync)).toBeNull();
    expect(sync).not.toHaveBeenCalled();
    expect(
      vi.mocked(externalProviderRepository.releaseProviderSyncRows).mock
        .calls[0][0]
    ).toEqual(['p1']);
  });

  it('releases the claim when the sync throws', async () => {
    vi.mocked(
      externalProviderRepository.claimProviderSyncRows
    ).mockResolvedValue({
      matched: 1,
      claimedIds: ['p1'],
    });

    const started = await startProviderSync(target, async () => {
      throw new Error('provider down');
    });

    await expect(started?.running).rejects.toThrow('provider down');
    expect(
      externalProviderRepository.releaseProviderSyncRows
    ).toHaveBeenCalledOnce();
  });

  it('runs unclaimed when the account has no provider row', async () => {
    vi.mocked(
      externalProviderRepository.claimProviderSyncRows
    ).mockResolvedValue({
      matched: 0,
      claimedIds: [],
    });

    const started = await startProviderSync(target, async () => 'ran');

    expect(await started?.running).toBe('ran');
  });

  it('keeps a finished sync successful when the release fails', async () => {
    vi.mocked(
      externalProviderRepository.claimProviderSyncRows
    ).mockResolvedValue({
      matched: 1,
      claimedIds: ['p1'],
    });
    vi.mocked(
      externalProviderRepository.releaseProviderSyncRows
    ).mockRejectedValue(new Error('db down'));

    const started = await startProviderSync(target, async () => 'synced');

    expect(await started?.running).toBe('synced');
    expect(log).toHaveBeenCalledWith(
      'warn',
      '[SYNC] Failed to release provider sync claim:',
      expect.any(Error)
    );
  });

  describe('while the sync runs', () => {
    const renewEvery = SYNC_CLAIM_RENEW_MINUTES * 60 * 1000;
    let finish: (value: string) => void;
    const longSync = () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      });

    beforeEach(() => {
      vi.useFakeTimers();
      vi.mocked(
        externalProviderRepository.claimProviderSyncRows
      ).mockResolvedValue({ matched: 1, claimedIds: ['p1'] });
      vi.mocked(
        externalProviderRepository.renewProviderSyncRows
      ).mockResolvedValue(['p1']);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('renews the claim and releases with the latest renewed time', async () => {
      const started = await startProviderSync(target, longSync);
      const [, claimedAt] = vi.mocked(
        externalProviderRepository.claimProviderSyncRows
      ).mock.calls[0];

      await vi.advanceTimersByTimeAsync(renewEvery);
      await vi.advanceTimersByTimeAsync(renewEvery);

      const renewals = vi.mocked(
        externalProviderRepository.renewProviderSyncRows
      ).mock.calls;
      expect(renewals).toHaveLength(2);
      expect(renewals[0][1]).toBe(claimedAt);
      expect(renewals[1][1]).toBe(renewals[0][2]);

      finish('synced');
      await started!.running;
      expect(
        externalProviderRepository.releaseProviderSyncRows
      ).toHaveBeenCalledWith(['p1'], renewals[1][2]);

      await vi.advanceTimersByTimeAsync(renewEvery);
      expect(
        externalProviderRepository.renewProviderSyncRows
      ).toHaveBeenCalledTimes(2);
    });

    it('waits for a renewal in flight before releasing', async () => {
      let finishRenewal = () => {};
      vi.mocked(
        externalProviderRepository.renewProviderSyncRows
      ).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRenewal = () => resolve(['p1']);
          })
      );
      const started = await startProviderSync(target, longSync);
      await vi.advanceTimersByTimeAsync(renewEvery);

      finish('synced');
      await vi.advanceTimersByTimeAsync(0);
      expect(
        externalProviderRepository.releaseProviderSyncRows
      ).not.toHaveBeenCalled();

      finishRenewal();
      await started!.running;
      const [, , renewedAt] = vi.mocked(
        externalProviderRepository.renewProviderSyncRows
      ).mock.calls[0];
      expect(
        externalProviderRepository.releaseProviderSyncRows
      ).toHaveBeenCalledWith(['p1'], renewedAt);
    });

    it('warns when the claim was lost', async () => {
      vi.mocked(
        externalProviderRepository.renewProviderSyncRows
      ).mockResolvedValue([]);
      const started = await startProviderSync(target, longSync);

      await vi.advanceTimersByTimeAsync(renewEvery);

      expect(log).toHaveBeenCalledWith(
        'warn',
        '[SYNC] A running sync lost its provider sync claim.'
      );
      finish('synced');
      await started!.running;
    });
  });
});
