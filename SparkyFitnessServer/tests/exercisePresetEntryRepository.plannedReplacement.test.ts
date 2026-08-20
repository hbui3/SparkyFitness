import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient } from '../db/poolManager.js';
import exercisePresetEntryRepository from '../models/exercisePresetEntryRepository.js';

vi.mock('../db/poolManager.js', () => ({ getClient: vi.fn() }));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

interface QueryResult {
  rows: { id: string }[];
  rowCount?: number;
}

function makeClient(deletedCount: number) {
  return {
    query: vi.fn(
      async (
        sql: string,
        _params?: readonly unknown[]
      ): Promise<QueryResult> => {
        if (sql.includes('DELETE FROM exercise_preset_entries epe')) {
          return {
            rows:
              deletedCount > 0
                ? [{ id: '11111111-1111-4111-8111-111111111111' }]
                : [],
            rowCount: deletedCount,
          };
        }
        return { rows: [], rowCount: 0 };
      }
    ),
    release: vi.fn(),
  };
}

describe('deleteOnePlannedPresetEntry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes at most one matching Workout Plan placeholder', async () => {
    const client = makeClient(1);
    vi.mocked(getClient).mockResolvedValue(client);

    const deleted =
      await exercisePresetEntryRepository.deleteOnePlannedPresetEntry(
        '99999999-9999-4999-8999-999999999999',
        42,
        '2026-08-24'
      );

    expect(deleted).toBe(1);
    const deleteCall = client.query.mock.calls.find(([sql]) =>
      sql.includes('DELETE FROM exercise_preset_entries epe')
    );
    expect(deleteCall?.[0]).toContain("epe.source = 'Workout Plan'");
    expect(deleteCall?.[0]).toContain('LIMIT 1');
    expect(deleteCall?.[0]).toContain(
      'ee.workout_plan_assignment_id IS NOT NULL'
    );
    expect(deleteCall?.[1]).toEqual([
      '99999999-9999-4999-8999-999999999999',
      42,
      '2026-08-24',
    ]);
    expect(client.release).toHaveBeenCalled();
  });

  it('leaves unrelated or already-unplanned sessions untouched', async () => {
    const client = makeClient(0);
    vi.mocked(getClient).mockResolvedValue(client);

    const deleted =
      await exercisePresetEntryRepository.deleteOnePlannedPresetEntry(
        '99999999-9999-4999-8999-999999999999',
        42,
        '2026-08-24'
      );

    expect(deleted).toBe(0);
  });
});
