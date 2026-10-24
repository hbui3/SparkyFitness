import { useQuery } from '@tanstack/react-query';
import type { ExerciseAlternativeMode } from '@workspace/shared';
import { useTranslation } from 'react-i18next';
import { getExerciseAlternatives } from '@/api/Exercises/exerciseAlternatives';
import { exerciseKeys } from '@/api/keys/exercises';

// Rankings shift only as the library or history changes; a few minutes of
// reuse keeps flipping between modes instant without going stale for long.
const ALTERNATIVES_STALE_MS = 5 * 60 * 1000;

export const useExerciseAlternatives = (
  exerciseId: string | null | undefined,
  mode: ExerciseAlternativeMode,
  excludeIds: readonly string[]
) => {
  const { t } = useTranslation();
  return useQuery({
    queryKey: exerciseKeys.alternatives(exerciseId ?? '', mode, excludeIds),
    queryFn: () => getExerciseAlternatives(exerciseId!, mode, excludeIds),
    enabled: !!exerciseId,
    staleTime: ALTERNATIVES_STALE_MS,
    meta: {
      errorMessage: t(
        'exercise.alternatives.failed',
        'Could not load alternatives'
      ),
    },
  });
};
