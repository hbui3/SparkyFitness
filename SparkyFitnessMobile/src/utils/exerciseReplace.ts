import type { ExerciseAlternative } from '@workspace/shared';
import type { Exercise } from '../types/exercise';
import type { ExternalExerciseItem } from '../types/externalExercises';

/**
 * What ExerciseSearch needs to open on ranked alternatives when it is
 * replacing an exercise rather than adding one (issue #1560).
 */
export interface ExerciseReplaceContext {
  exerciseId: string;
  exerciseName: string;
  /** Library ids already in the workout, so they are not suggested again. */
  excludeIds: string[];
}

interface ReplaceCandidateEntry {
  exerciseId: string | null | undefined;
  exerciseName: string;
}

/**
 * Builds the replace context for `target`, or undefined when the entry has
 * no library exercise to rank against (e.g. it was deleted from the library);
 * ExerciseSearch then opens on plain search as before.
 */
export function buildExerciseReplaceContext(
  target: ReplaceCandidateEntry | undefined,
  entries: readonly ReplaceCandidateEntry[]
): ExerciseReplaceContext | undefined {
  if (!target?.exerciseId) return undefined;
  const excludeIds = new Set<string>();
  for (const entry of entries) {
    if (entry.exerciseId && entry.exerciseId !== target.exerciseId) {
      excludeIds.add(entry.exerciseId);
    }
  }
  return {
    exerciseId: target.exerciseId,
    exerciseName: target.exerciseName,
    excludeIds: [...excludeIds],
  };
}

/** A library alternative as the Exercise that selection hands back. */
export function exerciseFromAlternative(
  alternative: ExerciseAlternative
): Exercise {
  return {
    id: alternative.id,
    name: alternative.name,
    category: alternative.category,
    modality: alternative.modality,
    equipment: alternative.equipment,
    primary_muscles: alternative.primary_muscles,
    secondary_muscles: alternative.secondary_muscles,
    calories_per_hour: alternative.calories_per_hour ?? 0,
    source: alternative.source ?? 'custom',
    images: alternative.images,
    tags: [],
    force: alternative.force,
    level: alternative.level,
    mechanic: alternative.mechanic,
    instructions: alternative.instructions,
    description: alternative.description,
  };
}

/** A catalog alternative in the shape the external import/preview path takes. */
export function externalItemFromAlternative(
  alternative: ExerciseAlternative
): ExternalExerciseItem {
  return {
    id: alternative.id,
    name: alternative.name,
    source: alternative.source ?? 'free-exercise-db',
    category: alternative.category,
    modality: alternative.modality,
    calories_per_hour: alternative.calories_per_hour,
    force: alternative.force,
    level: alternative.level,
    mechanic: alternative.mechanic,
    equipment: alternative.equipment,
    primary_muscles: alternative.primary_muscles,
    secondary_muscles: alternative.secondary_muscles,
    instructions: alternative.instructions,
    images: alternative.images,
  };
}
