import { invalidateExerciseCache } from '../../src/hooks/invalidateExerciseCache';
import {
  dailySummaryQueryKey,
  exerciseHistoryQueryKey,
  exerciseStatsQueryKeyRoot,
  suggestedExercisesQueryKey,
  workoutSessionQueryKeyRoot,
} from '../../src/hooks/queryKeys';
import { createTestQueryClient, type QueryClient } from './queryTestUtils';

describe('invalidateExerciseCache', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  test('invalidates workoutSession reads by prefix so a completion screen holding a no-HR snapshot refetches', () => {
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    const testDate = '2026-09-22';

    invalidateExerciseCache(queryClient, testDate);

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [...workoutSessionQueryKeyRoot],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: dailySummaryQueryKey(testDate),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [...exerciseHistoryQueryKey],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [...suggestedExercisesQueryKey],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [...exerciseStatsQueryKeyRoot],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['activeWorkoutPlan'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['workoutPlanTemplates'],
    });

    invalidateSpy.mockRestore();
  });
});
