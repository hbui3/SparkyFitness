import { vi, beforeEach, describe, expect, it } from 'vitest';
import exerciseEntryRepository from '../models/exerciseEntry.js';
import { importCorosActivitySummary } from '../integrations/coros/corosDataProcessor.js';

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn().mockResolvedValue('UTC'),
}));
vi.mock('../services/fitImportService.js', () => ({
  importFitBuffer: vi.fn(),
}));
vi.mock('../services/garminService.js', () => ({
  getOrCreateGarminExercise: vi.fn().mockResolvedValue({ id: 'exercise-1' }),
}));
vi.mock('../models/exerciseEntry.js', () => ({
  default: { createExerciseEntry: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());

describe('importCorosActivitySummary', () => {
  it('returns the id of the saved entry', async () => {
    // createExerciseEntry resolves to the saved row itself.
    vi.mocked(exerciseEntryRepository.createExerciseEntry).mockResolvedValue({
      id: 'entry-1',
    });

    await expect(
      importCorosActivitySummary('user-1', {
        labelId: 'label-1',
        name: 'Morning Run',
        date: '2026-10-01',
        sportType: 100,
        durationSeconds: 1800,
        distanceMeters: 5000,
        calories: 300,
        avgHeartRate: 150,
      } as Parameters<typeof importCorosActivitySummary>[1])
    ).resolves.toEqual({ id: 'entry-1' });

    expect(exerciseEntryRepository.createExerciseEntry).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        source_id: 'label-1',
        exercise_id: 'exercise-1',
      }),
      'user-1',
      'coros_mcp'
    );
  });
});
