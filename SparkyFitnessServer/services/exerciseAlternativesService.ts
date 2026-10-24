import {
  addDays,
  muscleSpellings,
  normalizeMuscleList,
  resolveExerciseModality,
  todayInZone,
  type ExerciseAlternative,
  type ExerciseAlternativeMode,
  type ExerciseAlternativesResponse,
} from '@workspace/shared';
import { log } from '../config/logging.js';
import freeExerciseDBService, {
  type FreeExercise,
} from '../integrations/freeexercisedb/FreeExerciseDBService.js';
import {
  getAlternativeLibraryCandidates,
  getAlternativeSourceExercise,
  getRecentExerciseUsage,
  hasActiveFreeExerciseDbProvider,
  type AlternativeExerciseRow,
  type ExerciseUsage,
} from '../models/exerciseAlternativesRepository.js';
import { describeError } from '../utils/errors.js';
import { normalizeToStringArray } from '../utils/exerciseJsonFields.js';
import {
  exerciseNameKey,
  isRankableSource,
  rankAlternatives,
  type AlternativeCandidate,
} from '../utils/exerciseAlternativesRanking.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';

/** How far back "recently performed" looks. */
export const ALTERNATIVES_RECENCY_DAYS = 90;
/**
 * The catalog is a nice-to-have: on a cold start it is a GitHub download, and
 * a self-hosted server may have no internet at all. Never let it hold up the
 * library results for longer than this.
 */
const CATALOG_TIMEOUT_MS = 4000;

export interface ExerciseAlternativesOptions {
  mode: ExerciseAlternativeMode;
  equipment: string[];
  excludeMuscles: string[];
  excludeIds: string[];
  includeCatalog: boolean;
  limit: number;
}

interface Candidate extends AlternativeCandidate {
  alternative: Omit<ExerciseAlternative, 'score' | 'reasons'>;
}

export class ExerciseNotFoundError extends Error {
  constructor() {
    super('Exercise not found');
    this.name = 'ExerciseNotFoundError';
  }
}

async function loadCatalog(): Promise<FreeExercise[] | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      freeExerciseDBService.getAllExercises(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), CATALOG_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    log(
      'warn',
      `[exerciseAlternatives] catalog unavailable: ${describeError(error)}`
    );
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function libraryCandidate(
  row: AlternativeExerciseRow,
  usage: ExerciseUsage | undefined
): Candidate {
  const modality = resolveExerciseModality(row.modality, row.category);
  return {
    key: `library:${row.id}`,
    name: row.name,
    modality,
    primaryMuscles: row.primary_muscles,
    secondaryMuscles: row.secondary_muscles,
    equipment: row.equipment,
    mechanic: row.mechanic,
    force: row.force,
    inLibrary: true,
    recentSessionCount: usage?.sessionCount ?? 0,
    alternative: {
      origin: 'library',
      id: row.id,
      name: row.name,
      source: row.source,
      category: row.category,
      modality,
      level: row.level,
      mechanic: row.mechanic,
      force: row.force,
      equipment: row.equipment,
      primary_muscles: row.primary_muscles,
      secondary_muscles: row.secondary_muscles,
      images: row.images,
      instructions: row.instructions,
      description: row.description,
      calories_per_hour: row.calories_per_hour,
      last_performed_date: usage?.lastPerformedDate ?? null,
    },
  };
}

function catalogCandidate(exercise: FreeExercise & { id: string }): Candidate {
  const modality = resolveExerciseModality(null, exercise.category);
  const equipment = exercise.equipment ? [exercise.equipment] : [];
  const primary = exercise.primaryMuscles ?? [];
  const secondary = exercise.secondaryMuscles ?? [];
  return {
    key: `catalog:${exercise.id}`,
    name: exercise.name,
    modality,
    primaryMuscles: primary,
    secondaryMuscles: secondary,
    equipment,
    mechanic: exercise.mechanic ?? null,
    force: exercise.force ?? null,
    inLibrary: false,
    recentSessionCount: 0,
    alternative: {
      origin: 'catalog',
      id: exercise.id,
      name: exercise.name,
      source: 'free-exercise-db',
      category: exercise.category ?? null,
      modality,
      level: exercise.level ?? null,
      mechanic: exercise.mechanic ?? null,
      force: exercise.force ?? null,
      equipment,
      primary_muscles: primary,
      secondary_muscles: secondary,
      images: (exercise.images ?? []).map((image) =>
        freeExerciseDBService.getExerciseImageUrl(image)
      ),
      instructions: normalizeToStringArray(exercise.instructions),
      description: null,
      calories_per_hour: null,
      last_performed_date: null,
    },
  };
}

/**
 * Ranked substitutes for `exerciseId` from the caller's visible library plus,
 * optionally, the Free Exercise DB catalog. Library rows win over catalog
 * rows for the same exercise (already imported, or same name), so a user
 * never sees a duplicate "import" of something they already have.
 */
export async function getExerciseAlternatives(
  userId: string,
  authenticatedUserId: string,
  exerciseId: string,
  options: ExerciseAlternativesOptions
): Promise<ExerciseAlternativesResponse> {
  const source = await getAlternativeSourceExercise(
    userId,
    authenticatedUserId,
    exerciseId
  );
  if (!source) throw new ExerciseNotFoundError();

  const sourceView = {
    modality: resolveExerciseModality(source.modality, source.category),
    primaryMuscles: source.primary_muscles,
    secondaryMuscles: source.secondary_muscles,
    equipment: source.equipment,
    mechanic: source.mechanic,
    force: source.force,
  };
  const sourceSummary = {
    id: source.id,
    name: source.name,
    primary_muscles: source.primary_muscles,
    equipment: source.equipment,
  };

  if (!isRankableSource(sourceView)) {
    return {
      source: sourceSummary,
      alternatives: [],
      rankable: false,
      catalog_available: true,
    };
  }

  const tz = await loadUserTimezone(userId);
  const today = todayInZone(tz);
  const spellings = muscleSpellings(
    normalizeMuscleList(source.primary_muscles)
  );

  const wantCatalog =
    options.includeCatalog &&
    (await hasActiveFreeExerciseDbProvider(userId, authenticatedUserId));
  const [libraryRows, usage, catalog] = await Promise.all([
    getAlternativeLibraryCandidates(userId, authenticatedUserId, spellings),
    getRecentExerciseUsage(
      userId,
      authenticatedUserId,
      addDays(today, -ALTERNATIVES_RECENCY_DAYS),
      today
    ),
    wantCatalog ? loadCatalog() : Promise.resolve(null),
  ]);

  const excluded = new Set(options.excludeIds);
  excluded.add(source.id);
  const usageById = new Map(usage.map((item) => [item.exerciseId, item]));

  // Names and catalog ids already represented, so catalog duplicates drop out.
  const takenNames = new Set<string>([exerciseNameKey(source.name)]);
  const takenCatalogIds = new Set<string>();
  if (source.source === 'free-exercise-db' && source.source_id) {
    takenCatalogIds.add(source.source_id);
  }

  // When two visible rows share a name (a private copy and a public one),
  // keep the one the user actually trains with.
  const orderedRows = [...libraryRows].sort(
    (a, b) =>
      (usageById.get(b.id)?.sessionCount ?? 0) -
      (usageById.get(a.id)?.sessionCount ?? 0)
  );
  const candidates: Candidate[] = [];
  for (const row of orderedRows) {
    if (row.source === 'free-exercise-db' && row.source_id) {
      takenCatalogIds.add(row.source_id);
    }
    const nameKey = exerciseNameKey(row.name);
    if (excluded.has(row.id)) {
      takenNames.add(nameKey);
      continue;
    }
    if (takenNames.has(nameKey)) continue;
    takenNames.add(nameKey);
    candidates.push(libraryCandidate(row, usageById.get(row.id)));
  }

  for (const exercise of catalog ?? []) {
    if (!exercise.id) continue;
    if (excluded.has(exercise.id) || takenCatalogIds.has(exercise.id)) continue;
    const nameKey = exerciseNameKey(exercise.name);
    if (takenNames.has(nameKey)) continue;
    takenNames.add(nameKey);
    candidates.push(catalogCandidate({ ...exercise, id: exercise.id }));
  }

  const ranked = rankAlternatives(sourceView, candidates, {
    mode: options.mode,
    availableEquipment: options.equipment,
    excludeMuscles: options.excludeMuscles,
  }).slice(0, options.limit);

  return {
    source: sourceSummary,
    alternatives: ranked.map(({ candidate, score, reasons }) => ({
      ...candidate.alternative,
      score,
      reasons,
    })),
    rankable: true,
    catalog_available: !wantCatalog || catalog !== null,
  };
}
