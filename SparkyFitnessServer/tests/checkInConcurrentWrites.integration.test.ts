/**
 * Check-ins are unique per user and day. Two writes for the same day that
 * overlap both find no row and insert; the second must update the first
 * rather than fail on the unique index and lose its values.
 *
 * Skipped unless a test database is reachable, since the tests briefly lock
 * the whole check-in table.
 */

import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { endPool } from '../db/poolManager.js';
import measurementRepository from '../models/measurementRepository.js';

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
  if (process.env.SKIP_RLS_MATRIX === '1') return false;
  if (!process.env.SPARKY_FITNESS_DB_HOST) return false;
  // These tests lock the whole table, so only run against a test database.
  if (!/(^|[_-])test([_-]|$)/i.test(process.env.SPARKY_FITNESS_DB_NAME ?? ''))
    return false;
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

const RUN = await isDbReachable();

describe.runIf(RUN)('overlapping check-in writes for one day', () => {
  let db: pg.Client;
  const userId = randomUUID();

  const dayRows = async (entryDate: string) =>
    (
      await db.query(
        `SELECT steps, weight, body_fat_percentage
         FROM public.check_in_measurements
         WHERE user_id = $1 AND entry_date = $2`,
        [userId, entryDate]
      )
    ).rows;

  let gate: pg.Client;

  // Holds back inserts (but not reads) until every write is waiting to insert,
  // so each one has already looked up the day and found no row.
  const raceToInsert = async (writes: (() => Promise<unknown>)[]) => {
    await gate.query('BEGIN');
    await gate.query('LOCK TABLE public.check_in_measurements IN SHARE MODE');
    const running = writes.map((write) => write());
    try {
      await vi.waitFor(
        async () => {
          const waiting = await db.query(
            `SELECT count(*)::int AS n FROM pg_locks l
             JOIN pg_class c ON c.oid = l.relation
             WHERE c.relname = 'check_in_measurements' AND NOT l.granted`
          );
          expect(waiting.rows[0].n).toBeGreaterThanOrEqual(writes.length);
        },
        { timeout: 10000, interval: 50 }
      );
    } finally {
      // Release the table even if the writes never reached it.
      await gate.query('COMMIT');
    }
    await Promise.all(running);
  };

  beforeAll(async () => {
    db = ownerClient();
    await db.connect();
    gate = ownerClient();
    await gate.connect();
    await db.query(
      'INSERT INTO public."user" (id, email, email_verified) VALUES ($1, $2, true)',
      [userId, `checkin-race-${userId}@example.test`]
    );
  });

  afterAll(async () => {
    await db.query('DELETE FROM public."user" WHERE id = $1', [userId]);
    await db.end();
    await gate.end();
    await endPool();
  });

  it('keeps the larger step total', async () => {
    await raceToInsert([
      () =>
        measurementRepository.upsertStepData(
          userId,
          userId,
          5000,
          '2026-09-20'
        ),
      () =>
        measurementRepository.upsertStepData(
          userId,
          userId,
          8000,
          '2026-09-20'
        ),
    ]);

    expect(await dayRows('2026-09-20')).toEqual([
      { steps: 8000, weight: null, body_fat_percentage: null },
    ]);
  });

  it('keeps both measurements written to one day', async () => {
    await raceToInsert([
      () =>
        measurementRepository.upsertCheckInMeasurements(
          userId,
          userId,
          '2026-09-21',
          { weight: 80 }
        ),
      () =>
        measurementRepository.upsertCheckInMeasurements(
          userId,
          userId,
          '2026-09-21',
          { body_fat_percentage: 20 }
        ),
    ]);

    expect(await dayRows('2026-09-21')).toEqual([
      { steps: null, weight: 80, body_fat_percentage: 20 },
    ]);
  });

  it('merges two overlapping batches', async () => {
    await raceToInsert([
      () =>
        measurementRepository.bulkUpsertCheckInMeasurements(userId, userId, [
          {
            entryDate: '2026-09-22',
            measurements: { weight: 81, steps: 3000 },
          },
        ]),
      () =>
        measurementRepository.bulkUpsertCheckInMeasurements(userId, userId, [
          {
            entryDate: '2026-09-22',
            measurements: { body_fat_percentage: 21, steps: 4000 },
          },
        ]),
    ]);

    expect(await dayRows('2026-09-22')).toEqual([
      { steps: 4000, weight: 81, body_fat_percentage: 21 },
    ]);
  });
});
