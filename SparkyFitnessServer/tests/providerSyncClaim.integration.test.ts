/**
 * A sync claims its external_data_providers row through sync_started_at, so a
 * second sync for the same account is skipped. These run the real claim and
 * release queries against a migrated database, including two claims racing
 * for one row.
 *
 * Skipped when no database is reachable, like the other integration tests.
 */

import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { endPool } from '../db/poolManager.js';
import externalProviderRepository from '../models/externalProviderRepository.js';
import {
  claimProviderSync,
  releaseProviderSync,
  SYNC_CLAIM_EXPIRY_MINUTES,
} from '../services/providerSyncClaim.js';

function ownerClient() {
  return new pg.Client({
    host: process.env.SPARKY_FITNESS_DB_HOST,
    port: Number(process.env.SPARKY_FITNESS_DB_PORT) || 5432,
    database: process.env.SPARKY_FITNESS_DB_NAME,
    user: process.env.SPARKY_FITNESS_DB_USER,
    password: process.env.SPARKY_FITNESS_DB_PASSWORD,
    connectionTimeoutMillis: 2000,
  });
}

async function isDbReachable(): Promise<boolean> {
  if (process.env.SKIP_PROVIDER_SYNC_CLAIM_DB === '1') return false;
  if (!process.env.SPARKY_FITNESS_DB_HOST) return false;
  const probe = ownerClient();
  try {
    await probe.connect();
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
}

describe('provider sync claims in the database', () => {
  let dbAvailable = false;
  let db: pg.Client;
  const userId = randomUUID();
  let garminId: string;
  let hevyIds: string[];

  const syncStartedAt = async (id: string): Promise<Date | null> =>
    (
      await db.query(
        'SELECT sync_started_at FROM external_data_providers WHERE id = $1',
        [id]
      )
    ).rows[0].sync_started_at;

  beforeAll(async () => {
    dbAvailable = await isDbReachable();
    if (!dbAvailable) return;
    db = ownerClient();
    await db.connect();
    await db.query(
      'INSERT INTO public."user" (id, email, email_verified) VALUES ($1, $2, true)',
      [userId, `sync-claim-${userId}@example.com`]
    );
    const insert = async (type: string, name: string) =>
      (
        await db.query(
          `INSERT INTO external_data_providers (user_id, provider_name, provider_type)
           VALUES ($1, $2, $3) RETURNING id`,
          [userId, name, type]
        )
      ).rows[0].id as string;
    garminId = await insert('garmin', 'Garmin');
    hevyIds = [await insert('hevy', 'Hevy A'), await insert('hevy', 'Hevy B')];
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await db.query('DELETE FROM public."user" WHERE id = $1', [userId]);
    await db.end();
    await endPool();
  });

  it('lets one of two racing claims win and frees the row on release', async () => {
    if (!dbAvailable) return;
    const target = { userId, providerType: 'garmin' };

    const [a, b] = await Promise.all([
      claimProviderSync(target),
      claimProviderSync(target),
    ]);

    const winners = [a, b].filter((claim) => claim !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.ids).toEqual([garminId]);
    expect(await syncStartedAt(garminId)).not.toBeNull();

    await releaseProviderSync(winners[0]!);
    expect(await syncStartedAt(garminId)).toBeNull();
    expect(await claimProviderSync(target)).not.toBeNull();
    await db.query(
      'UPDATE external_data_providers SET sync_started_at = NULL WHERE id = $1',
      [garminId]
    );
  });

  it('claims one connection without blocking the user’s other one', async () => {
    if (!dbAvailable) return;

    const first = await claimProviderSync({ userId, providerId: hevyIds[0] });
    const second = await claimProviderSync({ userId, providerId: hevyIds[1] });

    expect(first?.ids).toEqual([hevyIds[0]]);
    expect(second?.ids).toEqual([hevyIds[1]]);
    expect(
      await claimProviderSync({ userId, providerId: hevyIds[0] })
    ).toBeNull();
    await releaseProviderSync(first!);
    await releaseProviderSync(second!);
  });

  it('takes over a claim left past the expiry, and the old holder cannot release it', async () => {
    if (!dbAvailable) return;
    const stale = new Date(
      Date.now() - (SYNC_CLAIM_EXPIRY_MINUTES + 1) * 60 * 1000
    );
    await db.query(
      'UPDATE external_data_providers SET sync_started_at = $1 WHERE id = $2',
      [stale, garminId]
    );

    const fresh = await claimProviderSync({ userId, providerId: garminId });
    expect(fresh).not.toBeNull();

    await externalProviderRepository.releaseProviderSyncRows([garminId], stale);
    expect(await syncStartedAt(garminId)).toEqual(fresh!.claimedAt);

    await releaseProviderSync(fresh!);
    expect(await syncStartedAt(garminId)).toBeNull();
  });

  it('keeps a renewed claim past the expiry, and only its holder can renew it', async () => {
    if (!dbAvailable) return;
    const claimedAt = new Date(
      Date.now() - (SYNC_CLAIM_EXPIRY_MINUTES + 1) * 60 * 1000
    );
    await db.query(
      'UPDATE external_data_providers SET sync_started_at = $1 WHERE id = $2',
      [claimedAt, garminId]
    );

    const renewedAt = new Date();
    expect(
      await externalProviderRepository.renewProviderSyncRows(
        [garminId],
        claimedAt,
        renewedAt
      )
    ).toEqual([garminId]);
    expect(
      await claimProviderSync({ userId, providerId: garminId })
    ).toBeNull();
    expect(
      await externalProviderRepository.renewProviderSyncRows(
        [garminId],
        claimedAt,
        new Date()
      )
    ).toEqual([]);
    expect(await syncStartedAt(garminId)).toEqual(renewedAt);

    await releaseProviderSync({ ids: [garminId], claimedAt: renewedAt });
    expect(await syncStartedAt(garminId)).toBeNull();
  });

  it('does not claim another user’s row by id', async () => {
    if (!dbAvailable) return;

    const claim = await claimProviderSync({
      userId: randomUUID(),
      providerId: garminId,
    });

    expect(claim?.ids).toEqual([]);
    expect(await syncStartedAt(garminId)).toBeNull();
  });

  it('runs unclaimed when the user has no row of that type', async () => {
    if (!dbAvailable) return;
    expect(await claimProviderSync({ userId, providerType: 'oura' })).toEqual({
      ids: [],
      claimedAt: expect.any(Date),
    });
  });
});
