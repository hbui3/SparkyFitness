import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../models/exerciseEntry.js', () => ({
  default: {
    createExerciseEntry: vi.fn().mockResolvedValue({ id: 'entry-1' }),
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
  default: { createActivityDetail: vi.fn().mockResolvedValue(undefined) },
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
    createExercisePresetEntry: vi
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
  vi.mocked(activityDetailsRepository.createActivityDetail).mockResolvedValue(
    undefined
  );
});

describe('processSpeedianceWorkouts', () => {
  it('replaces only the selected Speediance range and maps the workout entry', async () => {
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
    ).toHaveBeenCalledWith('user-1', '2026-08-01', '2026-08-18', 'Speediance');
    expect(
      exercisePresetEntryRepository.deleteExercisePresetEntriesByEntrySourceAndDate
    ).toHaveBeenCalledWith('user-1', '2026-08-01', '2026-08-18', 'Speediance');
    expect(
      exercisePresetEntryRepository.deleteOnePlannedPresetEntry
    ).toHaveBeenCalledWith('user-1', 42, '2026-08-18');

    const createEntry = vi.mocked(exerciseEntryRepository.createExerciseEntry);
    expect(createEntry).toHaveBeenCalledTimes(1);
    expect(createEntry).toHaveBeenCalledWith(
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
    vi.mocked(activityDetailsRepository.createActivityDetail).mockRejectedValue(
      new Error('detail table unavailable')
    );

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

    expect(exerciseEntryRepository.createExerciseEntry).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ source_id: 'training-123:0', sets: [] }),
      'user-1',
      'Speediance',
      'preset-entry-1'
    );
    expect(
      exercisePresetEntryRepository.deleteOnePlannedPresetEntry
    ).not.toHaveBeenCalled();
  });
});
