import type { PresetSessionResponse } from '@workspace/shared';
import type { CompletedSetMap } from '../stores/activeWorkoutStore';

/** Per-exercise completion used by the active header and Android notification. */
export interface ExerciseProgress {
  entryId: string;
  totalSets: number;
  completedSets: number;
}

export function buildExerciseProgress(
  session: PresetSessionResponse,
  completedSetIds: CompletedSetMap
): ExerciseProgress[] {
  return session.exercises.map((exercise) => ({
    entryId: exercise.id,
    totalSets: exercise.sets.length,
    completedSets: exercise.sets.filter(
      (set) => completedSetIds[String(set.id)]
    ).length,
  }));
}
