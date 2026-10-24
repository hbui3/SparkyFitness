import { useQuery } from '@tanstack/react-query';
import type { ExerciseAlternativeMode } from '@workspace/shared';
import { fetchExerciseAlternatives } from '../services/api/exerciseApi';
import { exerciseAlternativesQueryKey } from './queryKeys';

// Rankings shift only as the library or history changes; a few minutes of
// reuse keeps flipping between modes instant without going stale for long.
const ALTERNATIVES_STALE_MS = 5 * 60 * 1000;

export function useExerciseAlternatives(
  exerciseId: string | null | undefined,
  mode: ExerciseAlternativeMode,
  excludeIds: readonly string[],
  enabled = true
) {
  return useQuery({
    queryKey: exerciseAlternativesQueryKey(exerciseId ?? '', mode, excludeIds),
    queryFn: () => fetchExerciseAlternatives(exerciseId!, mode, excludeIds),
    enabled: enabled && !!exerciseId,
    staleTime: ALTERNATIVES_STALE_MS,
  });
}
