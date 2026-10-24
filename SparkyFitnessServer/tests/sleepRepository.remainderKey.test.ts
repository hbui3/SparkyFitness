import { beforeEach, describe, expect, it, vi } from 'vitest';
import sleepRepository from '../models/sleepRepository.js';
import { getClient } from '../db/poolManager.js';

vi.mock('../db/poolManager.js', () => ({
  getClient: vi.fn(),
}));
vi.mock('../config/logging', () => ({
  log: vi.fn(),
}));

type StageRow = {
  id: string;
  entry_id: string;
  user_id: string;
  stage_type: string;
  start_time: Date;
  end_time: Date;
  duration_in_seconds: number;
};

const at = (iso: string) => new Date(iso);
const keyOf = (row: Pick<StageRow, 'entry_id' | 'start_time' | 'end_time'>) =>
  `${row.entry_id}|${row.start_time.toISOString()}|${row.end_time.toISOString()}`;

describe('mergeSleepStageEvents remainder keys', () => {
  const userId = 'user-1';
  const entryId = 'entry-1';
  let rows: StageRow[];
  let nextId: number;

  beforeEach(() => {
    rows = [];
    nextId = 1;
    const client = {
      query: vi.fn(async (text: string, values: unknown[] = []) => {
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
          return { rows: [] };
        }
        if (
          text.includes('start_time < $4') &&
          text.includes('end_time > $3')
        ) {
          const windowStart = at(String(values[2])).getTime();
          const windowEnd = at(String(values[3])).getTime();
          return {
            rows: rows.filter(
              (row) =>
                row.entry_id === values[0] &&
                row.user_id === values[1] &&
                row.start_time.getTime() < windowEnd &&
                row.end_time.getTime() > windowStart
            ),
          };
        }
        if (
          text.startsWith('DELETE FROM sleep_entry_stages\n       WHERE id')
        ) {
          rows = rows.filter(
            (row) =>
              !(
                row.id === values[0] &&
                row.entry_id === values[1] &&
                row.user_id === values[2]
              )
          );
          return { rows: [] };
        }
        if (text.includes('SET start_time = $4')) {
          const start = at(String(values[3]));
          const end = at(String(values[4]));
          const clash = rows.find(
            (row) =>
              row.id !== values[0] &&
              keyOf({
                entry_id: String(values[1]),
                start_time: start,
                end_time: end,
              }) === keyOf(row)
          );
          if (clash) {
            const error = new Error('duplicate key value') as Error & {
              code: string;
            };
            error.code = '23505';
            throw error;
          }
          return { rows: [] };
        }
        if (text.includes('INSERT INTO sleep_entry_stages')) {
          const start = at(String(values[3]));
          const end = at(String(values[4]));
          const incoming: StageRow = {
            id: `new-${nextId++}`,
            entry_id: String(values[0]),
            user_id: String(values[1]),
            stage_type: String(values[2]),
            start_time: start,
            end_time: end,
            duration_in_seconds: Number(values[5]),
          };
          const existing = rows.find((row) => keyOf(row) === keyOf(incoming));
          if (existing && text.includes('DO NOTHING')) {
            return { rows: [] };
          }
          if (existing && text.includes('DO UPDATE')) {
            existing.stage_type = incoming.stage_type;
            existing.duration_in_seconds = incoming.duration_in_seconds;
            return { rows: [{ id: existing.id }] };
          }
          if (existing) {
            const error = new Error('duplicate key value') as Error & {
              code: string;
            };
            error.code = '23505';
            throw error;
          }
          rows.push(incoming);
          return { rows: [{ id: incoming.id }] };
        }
        if (
          text.includes('AND s.start_time >= $3') &&
          text.includes('DELETE')
        ) {
          const windowStart = at(String(values[2])).getTime();
          const windowEnd = at(String(values[3])).getTime();
          const keptStarts = values[4] as string[];
          const keptEnds = values[5] as string[];
          const kept = new Set(
            keptStarts.map(
              (start, index) =>
                `${at(start).toISOString()}|${at(keptEnds[index]).toISOString()}`
            )
          );
          const deleted = rows.filter(
            (row) =>
              row.entry_id === values[0] &&
              row.user_id === values[1] &&
              row.start_time.getTime() >= windowStart &&
              row.end_time.getTime() <= windowEnd &&
              !kept.has(
                `${row.start_time.toISOString()}|${row.end_time.toISOString()}`
              )
          );
          rows = rows.filter((row) => !deleted.includes(row));
          return { rows: deleted.map((row) => ({ id: row.id })) };
        }
        throw new Error(`unexpected query: ${text}`);
      }),
      release: vi.fn(),
    };
    vi.mocked(getClient).mockResolvedValue(client as never);
  });

  it('does not rewrite a crossing stage onto a key that already exists', async () => {
    rows.push(
      {
        id: 'long',
        entry_id: entryId,
        user_id: userId,
        stage_type: 'light',
        start_time: at('2024-01-16T00:00:00.000Z'),
        end_time: at('2024-01-16T10:00:00.000Z'),
        duration_in_seconds: 36000,
      },
      {
        id: 'short',
        entry_id: entryId,
        user_id: userId,
        stage_type: 'deep',
        start_time: at('2024-01-16T00:00:00.000Z'),
        end_time: at('2024-01-16T05:00:00.000Z'),
        duration_in_seconds: 12345,
      }
    );

    await expect(
      sleepRepository.mergeSleepStageEvents(userId, entryId, [
        {
          stage_type: 'light',
          start_time: '2024-01-16T05:00:00.000Z',
          end_time: '2024-01-16T15:00:00.000Z',
          duration_in_seconds: 36000,
        },
      ])
    ).resolves.toBeDefined();

    expect(rows.map((row) => row.id)).not.toContain('long');
    const kept = rows.find((row) => row.id === 'short');
    expect(kept?.stage_type).toBe('deep');
    expect(kept?.duration_in_seconds).toBe(12345);
    expect(
      rows
        .map((row) => [
          row.start_time.toISOString(),
          row.end_time.toISOString(),
        ])
        .sort()
    ).toEqual([
      ['2024-01-16T00:00:00.000Z', '2024-01-16T05:00:00.000Z'],
      ['2024-01-16T05:00:00.000Z', '2024-01-16T15:00:00.000Z'],
    ]);
  });
});
