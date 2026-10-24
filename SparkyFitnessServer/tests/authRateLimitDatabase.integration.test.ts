/**
 * Sign-in rate limits are stored in the rate_limit table so that every server
 * instance enforces one shared limit. This drives the real auth configuration
 * against a migrated database and checks that the counter lives in that
 * table, not in the process.
 *
 * Skipped when no database is reachable, like the other integration tests.
 */

import { randomInt } from 'node:crypto';
import pg from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { endPool } from '../db/poolManager.js';

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
  if (process.env.SKIP_AUTH_RATE_LIMIT_DB === '1') return false;
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

describe('sign-in rate limits in the database', () => {
  let dbAvailable = false;
  let db: pg.Client;
  // A documentation-range address no other test uses.
  const ip = `203.0.113.${randomInt(1, 255)}`;

  beforeAll(async () => {
    dbAvailable = await isDbReachable();
    if (!dbAvailable) return;
    db = ownerClient();
    await db.connect();
    await db.query('DELETE FROM rate_limit WHERE key LIKE $1', [`${ip}%`]);
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await db.query('DELETE FROM rate_limit WHERE key LIKE $1', [`${ip}%`]);
    await db.end();
    await endPool();
  });

  it('counts sign-in attempts in rate_limit and blocks past the limit', async () => {
    if (!dbAvailable) return;

    const { auth } = await import('../auth.js');
    // The same settings auth.ts reads, with its defaults.
    const max =
      Number.parseInt(
        process.env.SPARKY_FITNESS_SIGN_IN_RATELIMIT_MAX ?? '',
        10
      ) || 4;
    const windowSeconds =
      Number.parseInt(
        process.env.SPARKY_FITNESS_SIGN_IN_RATELIMIT_WINDOW ?? '',
        10
      ) || 60;
    const signIn = () =>
      auth.handler(
        new Request('http://localhost:3010/api/auth/sign-in/email', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': ip,
          },
          body: JSON.stringify({
            email: 'nobody@example.com',
            password: 'not-a-password',
          }),
        })
      );

    for (let i = 0; i < max; i++) {
      expect((await signIn()).status).not.toBe(429);
    }
    const blocked = await signIn();
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers.get('x-retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(windowSeconds);

    const { rows } = await db.query(
      'SELECT count FROM rate_limit WHERE key LIKE $1',
      [`${ip}%`]
    );
    expect(rows).toEqual([{ count: max }]);

    // Clearing the stored counter lifts the block, so the decision was read
    // from the table rather than from this process's memory.
    await db.query('DELETE FROM rate_limit WHERE key LIKE $1', [`${ip}%`]);
    expect((await signIn()).status).not.toBe(429);
  });
});
