import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAlternativeLibraryCandidates,
  getAlternativeSourceExercise,
  getRecentExerciseUsage,
  hasActiveFreeExerciseDbProvider,
  type AlternativeExerciseRow,
} from '../models/exerciseAlternativesRepository.js';
import freeExerciseDBService from '../integrations/freeexercisedb/FreeExerciseDBService.js';
import {
  ExerciseNotFoundError,
  getExerciseAlternatives,
  type ExerciseAlternativesOptions,
} from '../services/exerciseAlternativesService.js';

vi.mock('../models/exerciseAlternativesRepository.js', () => ({
  getAlternativeSourceExercise: vi.fn(),
  getAlternativeLibraryCandidates: vi.fn(),
  getRecentExerciseUsage: vi.fn(),
  hasActiveFreeExerciseDbProvider: vi.fn(),
}));
vi.mock('../integrations/freeexercisedb/FreeExerciseDBService.js', () => ({
  default: {
    getAllExercises: vi.fn(),
    getExerciseImageUrl: (path: string) => `https://cdn.example/${path}`,
  },
}));
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn().mockResolvedValue('UTC'),
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

function row(
  overrides: Partial<AlternativeExerciseRow>
): AlternativeExerciseRow {
  return {
    id: 'id',
    name: 'Exercise',
    source: 'custom',
    source_id: null,
    category: 'strength',
    modality: 'weight_reps',
    level: null,
    mechanic: null,
    force: null,
    equipment: ['dumbbell'],
    primary_muscles: ['chest'],
    secondary_muscles: [],
    images: [],
    instructions: [],
    description: null,
    calories_per_hour: 300,
    ...overrides,
  };
}

const bench = row({
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Barbell Bench Press',
  equipment: ['barbell'],
});

const options: ExerciseAlternativesOptions = {
  mode: 'similar',
  equipment: [],
  excludeMuscles: [],
  excludeIds: [],
  includeCatalog: true,
  limit: 20,
};

beforeEach(() => {
  vi.mocked(getAlternativeSourceExercise).mockResolvedValue(bench);
  vi.mocked(getAlternativeLibraryCandidates).mockResolvedValue([]);
  vi.mocked(getRecentExerciseUsage).mockResolvedValue([]);
  vi.mocked(hasActiveFreeExerciseDbProvider).mockResolvedValue(true);
  vi.mocked(freeExerciseDBService.getAllExercises).mockResolvedValue([]);
});

describe('getExerciseAlternatives', () => {
  it('throws ExerciseNotFoundError for an unknown or hidden exercise', async () => {
    vi.mocked(getAlternativeSourceExercise).mockResolvedValue(null);
    await expect(
      getExerciseAlternatives('u', 'u', bench.id, options)
    ).rejects.toBeInstanceOf(ExerciseNotFoundError);
  });

  it('reports unrankable sources without querying candidates', async () => {
    vi.mocked(getAlternativeSourceExercise).mockResolvedValue(
      row({ id: bench.id, primary_muscles: [] })
    );
    const result = await getExerciseAlternatives('u', 'u', bench.id, options);
    expect(result.rankable).toBe(false);
    expect(result.alternatives).toEqual([]);
    expect(getAlternativeLibraryCandidates).not.toHaveBeenCalled();
  });

  it('merges library and catalog, library first for the same exercise', async () => {
    vi.mocked(getAlternativeLibraryCandidates).mockResolvedValue([
      bench,
      row({
        id: 'lib-db',
        name: 'Dumbbell Bench Press',
        source: 'free-exercise-db',
        source_id: 'Dumbbell_Bench_Press',
      }),
      row({ id: 'lib-pushup', name: 'Push Up', equipment: [] }),
    ]);
    vi.mocked(freeExerciseDBService.getAllExercises).mockResolvedValue([
      // Already imported -> dropped by catalog id.
      {
        id: 'Dumbbell_Bench_Press',
        name: 'Dumbbell Bench Press',
        category: 'strength',
        equipment: 'dumbbell',
        primaryMuscles: ['chest'],
      },
      // Same name as a library row -> dropped by name.
      {
        id: 'Pushups',
        name: 'Push-Up',
        category: 'strength',
        equipment: 'body only',
        primaryMuscles: ['chest'],
      },
      {
        id: 'Cable_Crossover',
        name: 'Cable Crossover',
        category: 'strength',
        equipment: 'cable',
        primaryMuscles: ['chest'],
        images: ['Cable_Crossover/0.jpg'],
      },
    ]);
    vi.mocked(getRecentExerciseUsage).mockResolvedValue([
      {
        exerciseId: 'lib-db',
        sessionCount: 3,
        lastPerformedDate: '2026-09-20',
      },
    ]);

    const result = await getExerciseAlternatives('u', 'u', bench.id, options);

    expect(result.alternatives.map((a) => a.id)).toEqual([
      'lib-db',
      'lib-pushup',
      'Cable_Crossover',
    ]);
    expect(result.alternatives[0]).toMatchObject({
      origin: 'library',
      last_performed_date: '2026-09-20',
      reasons: expect.arrayContaining(['recently_performed', 'in_library']),
    });
    expect(result.alternatives[2]).toMatchObject({
      origin: 'catalog',
      source: 'free-exercise-db',
      images: ['https://cdn.example/Cable_Crossover/0.jpg'],
    });
    expect(result.catalog_available).toBe(true);
  });

  it('bounds recency to today so pre-created plan entries do not count', async () => {
    await getExerciseAlternatives('u', 'actor', bench.id, options);
    const [userId, actor, since, until] = vi.mocked(getRecentExerciseUsage).mock
      .calls[0];
    expect([userId, actor]).toEqual(['u', 'actor']);
    expect(since < until).toBe(true);
    expect(until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('skips the catalog when the provider is disabled or not requested', async () => {
    vi.mocked(hasActiveFreeExerciseDbProvider).mockResolvedValue(false);
    const disabled = await getExerciseAlternatives('u', 'u', bench.id, options);
    expect(freeExerciseDBService.getAllExercises).not.toHaveBeenCalled();
    expect(disabled.catalog_available).toBe(true);

    await getExerciseAlternatives('u', 'u', bench.id, {
      ...options,
      includeCatalog: false,
    });
    expect(freeExerciseDBService.getAllExercises).not.toHaveBeenCalled();
  });

  it('still returns library results when the catalog fails', async () => {
    vi.mocked(getAlternativeLibraryCandidates).mockResolvedValue([
      row({ id: 'lib-db', name: 'Dumbbell Bench Press' }),
    ]);
    vi.mocked(freeExerciseDBService.getAllExercises).mockRejectedValue(
      new Error('offline')
    );
    const result = await getExerciseAlternatives('u', 'u', bench.id, options);
    expect(result.alternatives.map((a) => a.id)).toEqual(['lib-db']);
    expect(result.catalog_available).toBe(false);
  });

  it('honours excludeIds for library and catalog ids, and the limit', async () => {
    vi.mocked(getAlternativeLibraryCandidates).mockResolvedValue([
      row({ id: 'in-workout', name: 'Dumbbell Bench Press' }),
      row({ id: 'fly', name: 'Dumbbell Fly' }),
      row({ id: 'press', name: 'Machine Press', equipment: ['machine'] }),
    ]);
    vi.mocked(freeExerciseDBService.getAllExercises).mockResolvedValue([
      {
        id: 'Skip_Me',
        name: 'Skip Me',
        category: 'strength',
        primaryMuscles: ['chest'],
      },
      // Same name as an excluded library row: must not sneak back in.
      {
        id: 'Dumbbell_Bench_Press',
        name: 'Dumbbell Bench Press',
        category: 'strength',
        primaryMuscles: ['chest'],
      },
    ]);
    const result = await getExerciseAlternatives('u', 'u', bench.id, {
      ...options,
      excludeIds: ['in-workout', 'Skip_Me'],
      limit: 1,
    });
    expect(result.alternatives).toHaveLength(1);
    expect(['fly', 'press']).toContain(result.alternatives[0].id);
  });
});
