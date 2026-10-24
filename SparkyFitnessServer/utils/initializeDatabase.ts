import type { PoolClient } from 'pg';
import { log } from '../config/logging.js';
import { getSystemClient } from '../db/poolManager.js';
import { applyMigrations } from './dbMigrations.js';
import { applyRlsPolicies } from './applyRlsPolicies.js';

const lockName = 'sparkyfitness:schema-initialization';

/**
 * Serializes schema initialization across server instances on one connection.
 * Keep schema startup work here and use the same client, so it cannot
 * continue on another connection after the lock-owning session is lost.
 */
async function initializeDatabase(): Promise<void> {
  const client: PoolClient = await getSystemClient();
  let destroyClient = true;
  try {
    // An instance that vanishes without closing its connection (node loss,
    // network partition) keeps holding the lock until PostgreSQL notices the
    // dead session. Server-side keepalives bound that to about a minute once
    // the session is idle, instead of the operating system default of hours;
    // a statement it was already running finishes first.
    await client.query(
      'SET tcp_keepalives_idle = 30; SET tcp_keepalives_interval = 10; SET tcp_keepalives_count = 3'
    );
    log('info', 'Waiting for the database initialization lock...');
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockName]);
    await applyMigrations(client);
    await applyRlsPolicies(client);
    const { rows } = await client.query<{ unlocked: boolean }>(
      'SELECT pg_advisory_unlock(hashtext($1)) AS unlocked',
      [lockName]
    );
    if (rows[0]?.unlocked !== true) {
      throw new Error('Failed to release the schema initialization lock.');
    }
    destroyClient = false;
  } finally {
    client.release(destroyClient);
  }
}

export { initializeDatabase };
