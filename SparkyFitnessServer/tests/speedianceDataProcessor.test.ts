import { beforeEach, describe, expect, it, vi } from 'vitest';

const transaction = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock('../db/poolManager.js', () => ({
  getClient: vi.fn(async () => transaction),
}));

vi.mock('../models/exerciseEntry.js', () => ({
  EXERCISE_ENTRY_TELEMETRY_COLUMNS: ['elapsed_time_seconds', 'max_heart_rate'],
  default: {
    _createExerciseEntryWithClient: vi
      .fn()
      .mockResolvedValue({ entry: { id: 'entry-1' }, operation: 'created' }),
    deleteExerciseEntriesByEntrySourceAndDate: vi.fn().mockResolvedValue(0),
  },
}));
vi.mock('../models/exercise.js', () => ({
  default: {
    findExerciseByNameAndUserId: vi
      .fn()
      .mockImplementation((name: string) =>
        Promise.resolve({ id: `exercise-${name}` })
      ),
    createExercise: vi.fn(),
    updateExercise: vi.fn(),
  },
}));
vi.mock('../models/activityDetailsRepository.js', () => ({
  default: {
    _createActivityDetailWithClient: vi.fn().mockResolvedValue(undefined),
    _deleteActivityDetailsByEntryIdAndProviderWithClient: vi
      .fn()
      .mockResolvedValue(undefined),
  },
}));
vi.mock('../models/workoutPresetRepository.js', () => ({
  default: {
    getWorkoutPresetByName: vi.fn().mockResolvedValue({ id: 42 }),
    createWorkoutPreset: vi.fn(),
    addExerciseToWorkoutPreset: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../models/exercisePresetEntryRepository.js', () => ({
  default: {
    updateExercisePresetEntryWithClient: vi
      .fn()
      .mockResolvedValue({ id: 'existing-parent' }),
    createExercisePresetEntryWithClient: vi
      .fn()
      .mockResolvedValue({ id: 'preset-entry-1' }),
    deleteExercisePresetEntriesByEntrySourceAndDate: vi
      .fn()
      .mockResolvedValue(0),
    deleteOnePlannedPresetEntry: vi.fn().mockResolvedValue(0),
  },
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

import { processSpeedianceWorkouts } from '../integrations/speediance/speedianceDataProcessor.js';
import type { SpeedianceWorkoutBundle } from '../integrations/speediance/speedianceDataProcessor.js';
import exerciseEntryRepository from '../models/exerciseEntry.js';
import exerciseRepository from '../models/exercise.js';
import activityDetailsRepository from '../models/activityDetailsRepository.js';
import exercisePresetEntryRepository from '../models/exercisePresetEntryRepository.js';
import workoutPresetRepository from '../models/workoutPresetRepository.js';

function sampleBundle(): SpeedianceWorkoutBundle {
  return {
    record: {
      trainingId: 'training-123',
      title: 'Upper Body',
      type: 5,
      startTimestamp: Date.parse('2026-08-18T05:30:00Z') / 1000,
      endTimestamp: null,
      trainingTime: 1_800,
      calorie: 210,
      totalCapacity: 3_400,
      raw: { trainingId: 'training-123' },
    },
    exercises: [
      {
        actionLibraryName: 'Chest Press',
        actionLibraryId: null,
        actionLibraryGroupId: 'group-1',
        completionMethod: 1,
        isLeftRight: false,
        totalCapacity: 425,
        maxWeight: 45,
        primaryMuscles: ['chest'],
        secondaryMuscles: ['triceps'],
        finishedReps: [
          {
            finishedCount: 10,
            targetCount: 12,
            capacity: 425,
            time: 0,
            leftRight: null,
            weights: [45, 45, 40, 40],
            leftWeights: [],
            rightWeights: [],
            raw: { finishedCount: 10 },
          },
        ],
        raw: { actionLibraryName: 'Chest Press' },
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  transaction.query.mockResolvedValue({ rows: [] });
  vi.mocked(workoutPresetRepository.getWorkoutPresetByName).mockResolvedValue({
    id: 42,
    user_id: 'user-1',
    description: 'Workout imported from Speediance: Upper Body',
  });
  vi.mocked(
    exerciseEntryRepository._createExerciseEntryWithClient
  ).mockResolvedValue({ entry: { id: 'entry-1' }, operation: 'created' });
  vi.mocked(
    activityDetailsRepository._createActivityDetailWithClient
  ).mockResolvedValue(undefined);
});

describe('processSpeedianceWorkouts', () => {
  it.each([
    ['manual', 'user-1', 'My own carefully planned workout'],
    ['shared', 'family-member', 'Workout imported from Speediance: Upper Body'],
  ])(
    'does not add imported exercises to a same-named %s template',
    async (_kind, ownerId, description) => {
      vi.mocked(
        workoutPresetRepository.getWorkoutPresetByName
      ).mockResolvedValue({
        id: 42,
        user_id: ownerId,
        description,
      });

      await processSpeedianceWorkouts(
        'user-1',
        'user-1',
        [sampleBundle()],
        '2026-08-01',
        '2026-08-18',
        'Europe/Berlin'
      );

      expect(
        workoutPresetRepository.addExerciseToWorkoutPreset
      ).not.toHaveBeenCalled();
      expect(
        exercisePresetEntryRepository.createExercisePresetEntryWithClient
      ).toHaveBeenCalledWith(
        transaction,
        'user-1',
        expect.objectContaining({ workout_preset_id: 42 }),
        'user-1'
      );
    }
  );

  it('upserts each workout atomically without deleting the selected date range', async () => {
    const result = await processSpeedianceWorkouts(
      'user-1',
      'user-1',
      [sampleBundle(), sampleBundle()],
      '2026-08-01',
      '2026-08-18',
      'Europe/Berlin'
    );

    expect(result).toEqual({
      importedWorkouts: 1,
      importedExercises: 1,
      skippedWorkouts: 0,
    });
    expect(
      exerciseEntryRepository.deleteExerciseEntriesByEntrySourceAndDate
    ).not.toHaveBeenCalled();
    expect(
      exercisePresetEntryRepository.deleteExercisePresetEntriesByEntrySourceAndDate
    ).not.toHaveBeenCalled();
    expect(
      exercisePresetEntryRepository.deleteOnePlannedPresetEntry
    ).toHaveBeenCalledWith('user-1', 42, '2026-08-18');

    const createEntry = vi.mocked(
      exerciseEntryRepository._createExerciseEntryWithClient
    );
    expect(createEntry).toHaveBeenCalledTimes(1);
    expect(createEntry).toHaveBeenCalledWith(
      transaction,
      'user-1',
      expect.objectContaining({
        entry_date: '2026-08-18',
        entry_time: '07:30',
        duration_minutes: 30,
        calories_burned: 210,
        source_id: 'training-123:group-1',
        entry_source: 'Speediance',
        sets: [
          expect.objectContaining({ weight: 42.5, reps: 10, duration: null }),
        ],
      }),
      'user-1',
      'Speediance',
      'preset-entry-1'
    );
  });

  it('keeps an imported workout when optional raw-detail storage fails', async () => {
    vi.mocked(
      activityDetailsRepository._createActivityDetailWithClient
    ).mockRejectedValue(new Error('detail table unavailable'));

    const result = await processSpeedianceWorkouts(
      'user-1',
      'user-1',
      [sampleBundle()],
      '2026-08-18',
      '2026-08-18',
      'UTC'
    );

    expect(result).toMatchObject({
      importedWorkouts: 1,
      importedExercises: 1,
      skippedWorkouts: 0,
    });
  });

  it('refreshes muscle metadata on an existing user-owned Speediance exercise', async () => {
    vi.mocked(
      exerciseRepository.findExerciseByNameAndUserId
    ).mockResolvedValueOnce({
      id: 'exercise-Chest Press',
      user_id: 'user-1',
      source: 'Speediance',
    });
    vi.mocked(exerciseRepository.updateExercise).mockResolvedValueOnce({
      id: 'exercise-Chest Press',
      user_id: 'user-1',
      source: 'Speediance',
    });

    await processSpeedianceWorkouts(
      'user-1',
      'user-1',
      [sampleBundle()],
      '2026-08-18',
      '2026-08-18',
      'UTC'
    );

    expect(exerciseRepository.updateExercise).toHaveBeenCalledWith(
      'exercise-Chest Press',
      'user-1',
      {
        primary_muscles: ['chest'],
        secondary_muscles: ['triceps'],
        modality: 'weight_reps',
      }
    );
  });

  it('creates a fallback session entry for Free Lift history', async () => {
    const bundle = sampleBundle();
    bundle.record.type = 1;
    bundle.exercises = [];

    await processSpeedianceWorkouts(
      'user-1',
      'user-1',
      [bundle],
      '2026-08-18',
      '2026-08-18',
      'UTC'
    );

    expect(
      exerciseEntryRepository._createExerciseEntryWithClient
    ).toHaveBeenCalledWith(
      transaction,
      'user-1',
      expect.objectContaining({ source_id: 'training-123:0' }),
      'user-1',
      'Speediance',
      'preset-entry-1'
    );
    expect(
      exercisePresetEntryRepository.deleteOnePlannedPresetEntry
    ).not.toHaveBeenCalled();
  });
  it('does not touch stored history when the provider returns an empty list', async () => {
    const result = await processSpeedianceWorkouts(
      'user-1',
      'user-1',
      [],
      '2026-08-01',
      '2026-08-18',
      'UTC'
    );
    expect(result).toEqual({
      importedWorkouts: 0,
      importedExercises: 0,
      skippedWorkouts: 0,
    });
    expect(transaction.query).not.toHaveBeenCalled();
    expect(
      exerciseEntryRepository.deleteExerciseEntriesByEntrySourceAndDate
    ).not.toHaveBeenCalled();
    expect(
      exercisePresetEntryRepository.deleteExercisePresetEntriesByEntrySourceAndDate
    ).not.toHaveBeenCalled();
  });

  it('reuses the stored workout identity and commits only after all exercise writes', async () => {
    transaction.query.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith('SELECT epe.id')
        ? [{ id: 'existing-parent', has_details: true, workout_preset_id: 42 }]
        : [],
    }));
    await processSpeedianceWorkouts(
      'user-1',
      'user-1',
      [sampleBundle()],
      '2026-08-18',
      '2026-08-18',
      'UTC'
    );
    expect(
      exercisePresetEntryRepository.createExercisePresetEntryWithClient
    ).not.toHaveBeenCalled();
    expect(
      exerciseEntryRepository._createExerciseEntryWithClient
    ).toHaveBeenCalledWith(
      transaction,
      'user-1',
      expect.objectContaining({ exercise_preset_entry_id: 'existing-parent' }),
      'user-1',
      'Speediance',
      'existing-parent'
    );
    const commit = transaction.query.mock.calls.findIndex(
      ([sql]) => sql === 'COMMIT'
    );
    expect(commit).toBeGreaterThan(0);
    expect(
      transaction.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')
    ).toBe(false);
    expect(transaction.release).toHaveBeenCalledTimes(1);
    // Re-syncing the same completed workout must not remove a second, still
    // planned session of the same preset on the same day.
    expect(
      exercisePresetEntryRepository.deleteOnePlannedPresetEntry
    ).not.toHaveBeenCalled();
  });

  it('keeps existing detailed history and reports a retryable failure when sets are missing', async () => {
    transaction.query.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith('SELECT epe.id')
        ? [{ id: 'existing-parent', has_details: true, workout_preset_id: 42 }]
        : [],
    }));
    const bundle = sampleBundle();
    bundle.exercises = [];
    const result = await processSpeedianceWorkouts(
      'user-1',
      'user-1',
      [bundle],
      '2026-08-18',
      '2026-08-18',
      'UTC'
    );
    expect(result).toEqual({
      importedWorkouts: 0,
      importedExercises: 0,
      skippedWorkouts: 1,
    });
    expect(
      exerciseEntryRepository._createExerciseEntryWithClient
    ).not.toHaveBeenCalled();
    expect(
      transaction.query.mock.calls.some(([sql]) =>
        String(sql).startsWith('DELETE')
      )
    ).toBe(false);
    expect(
      exercisePresetEntryRepository.deleteOnePlannedPresetEntry
    ).not.toHaveBeenCalled();
  });

  it.each(['provider', 'manual', 'split', 'watch'])(
    'counts totals once after a partial retry while preserving sets, notes and manual corrections (%s)',
    async (manual) => {
      const stored = [
        {
          id: 'entry-a',
          source_id: 'training-123:group-1',
          calories_burned: manual === 'manual' ? 240 : 210,
          duration_minutes:
            manual === 'watch' ? 37 : manual === 'provider' ? 30 : 35,
          manual_fields:
            manual === 'manual'
              ? ['calories_burned', 'duration_minutes']
              : manual === 'split'
                ? ['duration_minutes']
                : [],
          watch_duration_minutes: manual === 'watch' ? 37 : null,
          sets: ['original A set'],
          notes: 'My notes for A',
        },
        {
          id: 'entry-b',
          source_id: 'training-123:group-2',
          calories_burned: manual === 'split' || manual === 'watch' ? 240 : 0,
          duration_minutes: 0,
          manual_fields:
            manual === 'split' || manual === 'watch' ? ['calories_burned'] : [],
          watch_duration_minutes: null,
          sets: ['original B set'],
          notes: 'My notes for B',
        },
      ];
      const partial = sampleBundle();
      partial.exercises[0]!.actionLibraryGroupId = 'group-2';
      partial.exercises[0]!.actionLibraryName = 'Row';
      vi.mocked(
        exerciseEntryRepository._createExerciseEntryWithClient
      ).mockImplementation(
        async (
          _client,
          _user,
          data: {
            source_id: string;
            calories_burned: number;
            duration_minutes: number;
          }
        ) => {
          const row = stored.find((item) => item.source_id === data.source_id)!;
          if (!row.manual_fields.includes('calories_burned'))
            row.calories_burned = data.calories_burned;
          row.duration_minutes = data.duration_minutes;
          return { entry: { id: row.id }, operation: 'updated' };
        }
      );
      transaction.query.mockImplementation(
        async (sql: string, values?: unknown[]) => {
          if (sql.startsWith('SELECT epe.id')) {
            return {
              rows: [
                {
                  id: 'existing-parent',
                  has_details: true,
                  workout_preset_id: 42,
                },
              ],
            };
          }
          if (sql.startsWith('SELECT id, calories_burned'))
            return { rows: stored };
          if (sql.startsWith('UPDATE exercise_entries SET calories_burned')) {
            const row = stored.find((item) => item.id === values?.[2])!;
            row.calories_burned = Number(values?.[0]);
            row.duration_minutes = Number(values?.[1]);
          }
          return { rows: [] };
        }
      );

      const result = await processSpeedianceWorkouts(
        'user-1',
        'user-1',
        [partial],
        '2026-08-18',
        '2026-08-18',
        'UTC'
      );

      expect(result.skippedWorkouts).toBe(0);
      expect(stored.reduce((sum, row) => sum + row.calories_burned, 0)).toBe(
        manual === 'provider' ? 210 : 240
      );
      expect(stored.reduce((sum, row) => sum + row.duration_minutes, 0)).toBe(
        manual === 'watch' ? 37 : manual === 'provider' ? 30 : 35
      );
      expect(stored.map((row) => row.sets)).toEqual([
        ['original A set'],
        ['original B set'],
      ]);
      expect(stored.map((row) => row.notes)).toEqual([
        'My notes for A',
        'My notes for B',
      ]);
      const normalizationWrites = transaction.query.mock.calls.filter(([sql]) =>
        String(sql).startsWith('UPDATE exercise_entries SET calories_burned')
      );
      expect(normalizationWrites).toHaveLength(2);
      expect(normalizationWrites[1]?.[1]).toEqual([
        manual === 'split' || manual === 'watch' ? 240 : 0,
        0,
        'entry-b',
        'user-1',
        'existing-parent',
        'Speediance',
      ]);
      expect(transaction.query).toHaveBeenCalledWith('COMMIT');
    }
  );

  it('rolls back a whole workout if a later exercise cannot be stored', async () => {
    const bundle = sampleBundle();
    bundle.exercises.push({
      ...bundle.exercises[0]!,
      actionLibraryGroupId: 'group-2',
      actionLibraryName: 'Row',
    });
    vi.mocked(exerciseEntryRepository._createExerciseEntryWithClient)
      .mockResolvedValueOnce({
        entry: { id: 'first-entry' },
        operation: 'created',
      })
      .mockRejectedValueOnce(new Error('second exercise failed'));
    const result = await processSpeedianceWorkouts(
      'user-1',
      'user-1',
      [bundle],
      '2026-08-18',
      '2026-08-18',
      'UTC'
    );
    expect(result).toEqual({
      importedWorkouts: 0,
      importedExercises: 0,
      skippedWorkouts: 1,
    });
    expect(transaction.query).toHaveBeenCalledWith('ROLLBACK');
    expect(transaction.query).not.toHaveBeenCalledWith('COMMIT');
    expect(
      exercisePresetEntryRepository.deleteOnePlannedPresetEntry
    ).not.toHaveBeenCalled();
  });

  it('keeps repeated occurrences of the same exercise distinct', async () => {
    const bundle = sampleBundle();
    bundle.exercises.push({ ...bundle.exercises[0]! });
    await processSpeedianceWorkouts(
      'user-1',
      'user-1',
      [bundle],
      '2026-08-18',
      '2026-08-18',
      'UTC'
    );
    const ids = vi
      .mocked(exerciseEntryRepository._createExerciseEntryWithClient)
      .mock.calls.map((call) => call[2].source_id);
    expect(ids).toEqual(['training-123:group-1', 'training-123:group-1:1']);
  });

  it('does not erase an exercise’s stored sets when only part of a detail response has sets', async () => {
    const bundle = sampleBundle();
    bundle.exercises.push({
      ...bundle.exercises[0]!,
      actionLibraryGroupId: 'group-2',
      finishedReps: [],
    });
    await processSpeedianceWorkouts(
      'user-1',
      'user-1',
      [bundle],
      '2026-08-18',
      '2026-08-18',
      'UTC'
    );
    const partial = vi.mocked(
      exerciseEntryRepository._createExerciseEntryWithClient
    ).mock.calls[1]?.[2];
    expect(partial).not.toHaveProperty('sets');
  });
});
