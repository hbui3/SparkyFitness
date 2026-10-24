import externalProviderRepository from '../models/externalProviderRepository.js';
import { log } from '../config/logging.js';

/**
 * Which provider row a sync runs on: the row itself for providers a user can
 * connect more than once, otherwise the user's row of that provider type.
 */
export type SyncClaimTarget =
  | { userId: string; providerId: string }
  | { userId: string; providerType: string };

export interface ProviderSyncClaim {
  ids: string[];
  claimedAt: Date;
}

// A server that dies mid-sync frees the account after this. A running sync
// renews its claim well inside it, so a long sync never loses the claim.
export const SYNC_CLAIM_EXPIRY_MINUTES = 30;
export const SYNC_CLAIM_RENEW_MINUTES = 5;

export const SYNC_ALREADY_RUNNING_MESSAGE =
  'A sync is already running for this account. Try again in a few minutes.';

/** The 409 body a manual sync route sends when the account is already syncing. */
export const SYNC_ALREADY_RUNNING_RESPONSE = {
  error: SYNC_ALREADY_RUNNING_MESSAGE,
  code: 'SYNC_ALREADY_RUNNING',
};

/** The row a manual sync runs on: the one the request named, else the user's row of that type. */
export function syncClaimTarget(
  userId: string,
  providerType: string,
  providerId?: string | null
): SyncClaimTarget {
  return providerId ? { userId, providerId } : { userId, providerType };
}

/**
 * Claims the account for one sync, or returns null when another sync holds it.
 * With no matching row the sync runs unclaimed and reports its own
 * "not connected" error, as it did before claims existed.
 */
export async function claimProviderSync(
  target: SyncClaimTarget
): Promise<ProviderSyncClaim | null> {
  const claimedAt = new Date();
  const { matched, claimedIds } =
    await externalProviderRepository.claimProviderSyncRows(
      target,
      claimedAt,
      SYNC_CLAIM_EXPIRY_MINUTES
    );
  if (claimedIds.length < matched) {
    await releaseProviderSync({ ids: claimedIds, claimedAt });
    return null;
  }
  return { ids: claimedIds, claimedAt };
}

export async function releaseProviderSync(
  claim: ProviderSyncClaim
): Promise<void> {
  try {
    await externalProviderRepository.releaseProviderSyncRows(
      claim.ids,
      claim.claimedAt
    );
  } catch (error) {
    // The claim expires on its own, so a failed release only delays the next
    // sync; it must not turn a finished sync into a failed one.
    log('warn', '[SYNC] Failed to release provider sync claim:', error);
  }
}

/**
 * Claims the account and starts `sync`, or returns null when another sync
 * holds it. The claim is renewed while the sync runs and released when it
 * settles, so a caller that replies before the sync finishes still keeps the
 * account claimed until then. `running` is wrapped because awaiting a returned
 * promise would wait for it.
 */
export async function startProviderSync<T>(
  target: SyncClaimTarget,
  sync: () => Promise<T>
): Promise<{ running: Promise<T> } | null> {
  const claim = await claimProviderSync(target);
  if (!claim) return null;
  let renewal: Promise<void> = Promise.resolve();
  const renew = async () => {
    const renewedAt = new Date();
    try {
      const renewed = await externalProviderRepository.renewProviderSyncRows(
        claim.ids,
        claim.claimedAt,
        renewedAt
      );
      if (renewed.length > 0) claim.claimedAt = renewedAt;
      if (renewed.length < claim.ids.length) {
        log('warn', '[SYNC] A running sync lost its provider sync claim.');
      }
    } catch (error) {
      log('warn', '[SYNC] Failed to renew provider sync claim:', error);
    }
  };
  const timer = setInterval(
    () => {
      renewal = renewal.then(renew);
    },
    SYNC_CLAIM_RENEW_MINUTES * 60 * 1000
  );
  timer.unref();
  const running = (async () => {
    try {
      return await sync();
    } finally {
      clearInterval(timer);
      // Release with the latest renewed time, not one a renewal is replacing.
      await renewal;
      await releaseProviderSync(claim);
    }
  })();
  return { running };
}
