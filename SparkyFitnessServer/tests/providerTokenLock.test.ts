import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { withProviderTokenLock } from '../models/externalProviderRepository.js';

function fakeClient() {
  const calls: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      return { rows: [] };
    }),
  } as unknown as PoolClient;
  return { client, calls };
}

describe('withProviderTokenLock', () => {
  it('runs the refresh inside a transaction and returns its result', async () => {
    const { client, calls } = fakeClient();
    const result = await withProviderTokenLock(client, async () => {
      await client.query('SELECT ... FOR UPDATE');
      return 'new-access-token';
    });
    expect(result).toBe('new-access-token');
    expect(calls).toEqual(['BEGIN', 'SELECT ... FOR UPDATE', 'COMMIT']);
  });

  it('commits writes made before the refresh throws, then rethrows', async () => {
    const { client, calls } = fakeClient();
    const failure = new Error('reconnect required');
    await expect(
      withProviderTokenLock(client, async () => {
        await client.query('UPDATE ... SET encrypted_refresh_token = NULL');
        throw failure;
      })
    ).rejects.toBe(failure);
    expect(calls).toEqual([
      'BEGIN',
      'UPDATE ... SET encrypted_refresh_token = NULL',
      'COMMIT',
    ]);
  });
});
