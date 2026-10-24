import { vi, beforeEach, describe, it, expect } from 'vitest';

const processSleepEntry = vi.fn();
vi.mock('../services/measurementService.js', () => ({
  default: {
    processSleepEntry: (...args: unknown[]) => processSleepEntry(...args),
  },
}));
const deleteSleepEntriesByEntrySourceAndDate = vi
  .fn()
  .mockResolvedValue(undefined);
vi.mock('../models/sleepRepository.js', () => ({
  default: {
    deleteSleepEntriesByEntrySourceAndDate: (...args: unknown[]) =>
      deleteSleepEntriesByEntrySourceAndDate(...args),
  },
}));
vi.mock('../models/moodRepository.js', () => ({ default: {} }));
vi.mock('../models/food.js', () => ({ default: {} }));
vi.mock('../models/foodEntry.js', () => ({ default: {} }));
vi.mock('../models/mealType.js', () => ({ default: {} }));
vi.mock('../models/genericHealthRepository.js', () => ({}));
vi.mock('../db/poolManager.js', () => ({ getClient: vi.fn() }));
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn().mockResolvedValue('UTC'),
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

import { processGarminSleepData } from '../services/garmin/garminHealthProcessor.js';

const night = (overrides: Record<string, unknown> = {}) => ({
  entry_date: '2026-10-15',
  bedtime: '2026-10-14T23:00:00',
  wake_time: '2026-10-15T07:00:00',
  duration_in_seconds: 28800,
  source: 'garmin',
  ...overrides,
});

beforeEach(() => {
  processSleepEntry.mockReset();
  processSleepEntry.mockResolvedValue({ id: 'sleep-1' });
  deleteSleepEntriesByEntrySourceAndDate.mockClear();
});

describe('processGarminSleepData', () => {
  it('processes a night with both times', async () => {
    const result = await processGarminSleepData(
      'user-1',
      'user-1',
      [night()],
      '2026-10-15',
      '2026-10-15'
    );
    expect(processSleepEntry).toHaveBeenCalledWith('user-1', 'user-1', night());
    expect(result.processed).toHaveLength(1);
  });

  it('fails a night without a valid bedtime or wake time on its own, and still processes the rest', async () => {
    const missingWake = night({
      entry_date: '2026-10-13',
      wake_time: undefined,
    });
    const badBedtime = night({
      entry_date: '2026-10-14',
      bedtime: 'not a time',
    });

    const run = processGarminSleepData(
      'user-1',
      'user-1',
      [missingWake, badBedtime, night()],
      '2026-10-13',
      '2026-10-15'
    );

    await expect(run).rejects.toThrow(
      'Some Garmin sleep entries could not be processed.'
    );
    const report = JSON.parse(
      ((await run.catch((e: unknown) => e)) as Error).message
    ) as {
      processed: unknown[];
      errors: { message: string; entry: { entry_date: string } }[];
    };
    expect(report.errors.map((e) => e.entry.entry_date)).toEqual([
      '2026-10-13',
      '2026-10-14',
    ]);
    expect(report.errors[0].message).toBe(
      'Garmin sleep entry is missing a valid bedtime or wake_time.'
    );
    expect(report.processed).toHaveLength(1);
    expect(processSleepEntry).toHaveBeenCalledTimes(1);
    expect(processSleepEntry).toHaveBeenCalledWith('user-1', 'user-1', night());
  });
});
