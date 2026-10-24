import { useQuery } from '@tanstack/react-query';
import { fetchWorkoutLocations } from '../services/api/exerciseApi';
import { workoutLocationsQueryKey } from './queryKeys';

/**
 * Previously logged gym / location names (most recent first) for the live
 * workout's location prompt. Suggestions are a convenience, so a failed fetch
 * just yields none.
 */
export function useWorkoutLocations(options?: { enabled?: boolean }) {
  const { enabled = true } = options ?? {};
  const query = useQuery({
    queryKey: workoutLocationsQueryKey,
    queryFn: fetchWorkoutLocations,
    staleTime: 1000 * 60,
    enabled,
  });
  return query.data ?? [];
}
