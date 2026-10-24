import { apiCall } from '@/api/api';
import {
  exerciseAlternativesResponseSchema,
  type ExerciseAlternativeMode,
  type ExerciseAlternativesResponse,
} from '@workspace/shared';

/** Ranked substitutes for an exercise (issue #1560). */
export const getExerciseAlternatives = async (
  exerciseId: string,
  mode: ExerciseAlternativeMode,
  excludeIds: readonly string[] = []
): Promise<ExerciseAlternativesResponse> => {
  const response = await apiCall(
    `/v2/exercises/${encodeURIComponent(exerciseId)}/alternatives`,
    {
      method: 'GET',
      params: {
        mode,
        excludeIds: excludeIds.length > 0 ? excludeIds.join(',') : undefined,
      },
    }
  );
  return exerciseAlternativesResponseSchema.parse(response);
};
