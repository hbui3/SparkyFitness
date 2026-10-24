import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { fetchWorkoutCoachingSignals } from '../services/api/workoutCoachingApi';
import { useActiveWorkoutStore } from '../stores/activeWorkoutStore';
import { workoutSuggestionsQueryKeyRoot } from './queryKeys';

/**
 * Fetches adaptive coaching signals (issue #1560) for every exercise in the
 * live workout that hasn't been asked about yet — at start, and again for
 * exercises added or swapped in mid-workout — and captures them into the
 * store, where placeholder resolution picks them up. The workout in
 * progress is excluded server-side so its autosaved entries never count as
 * "last session".
 */
export function useLiveCoachingSignals(): void {
  const sessionId = useActiveWorkoutStore((s) => s.sessionId);
  const exerciseIds = useActiveWorkoutStore(
    useShallow((s) =>
      [
        ...new Set(
          (s.session?.exercises ?? [])
            .map((exercise) => exercise.exercise_id)
            .filter((id): id is string => id != null)
        ),
      ].sort()
    )
  );
  const captured = useActiveWorkoutStore((s) => s.coachingSignals);
  const captureCoachingSignals = useActiveWorkoutStore(
    (s) => s.captureCoachingSignals
  );

  const missing = useMemo(
    () => exerciseIds.filter((id) => !(id in captured)),
    [exerciseIds, captured]
  );

  const { data } = useQuery({
    queryKey: [...workoutSuggestionsQueryKeyRoot, 'live', sessionId, missing],
    queryFn: () => fetchWorkoutCoachingSignals(missing, sessionId ?? undefined),
    enabled: sessionId != null && missing.length > 0,
    staleTime: Infinity,
    // A failed fetch just means no adjustments; don't hammer the server.
    retry: 1,
  });

  useEffect(() => {
    if (data) captureCoachingSignals(missing, data.signals);
  }, [data, missing, captureCoachingSignals]);
}
