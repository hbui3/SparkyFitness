import { useQuery } from '@tanstack/react-query';
import { bodyWeightOnDay } from '@workspace/shared';
import { useLatestMeasurementsOnOrBefore } from './useMeasurements';
import { fetchMeasurementsRange } from '../services/api/measurementsApi';
import { addDays, getTodayDate } from '../utils/dateUtils';
import { measurementsRangeQueryKey } from './queryKeys';

/**
 * The lifter's body weight (kg) on `date`: the newest check-in weight on or
 * before it, or, when the workout is older than every check-in, the earliest
 * later one. Bodyweight exercises count it in their volume and estimated
 * maxes. Null while loading, on failure, or with no weight recorded, in which
 * case only the added weight counts (see `effectiveLoadKg`).
 *
 * Pass `enabled: false` when nothing on screen is a bodyweight exercise, so
 * ordinary workouts cost no extra request. The later-check-in lookup runs
 * only after the on-or-before query succeeds with no weight.
 */
export function useBodyWeightKg(
  date: string | null | undefined,
  enabled: boolean
): number | null {
  const day = date ?? getTodayDate();
  const { latestMeasurements, isSuccess } = useLatestMeasurementsOnOrBefore({
    date: day,
    enabled,
  });
  const onOrBefore = Number(latestMeasurements?.weight);
  const hasOnOrBefore = onOrBefore > 0;
  const today = getTodayDate();
  const fallbackStart = addDays(day, 1);
  const fallbackEnabled =
    enabled && isSuccess && !hasOnOrBefore && fallbackStart <= today;
  const fallback = useQuery({
    queryKey: measurementsRangeQueryKey(fallbackStart, today),
    queryFn: () => fetchMeasurementsRange(fallbackStart, today),
    enabled: fallbackEnabled,
  });

  if (!enabled) return null;
  if (hasOnOrBefore) return onOrBefore;
  if (!fallback.data) return null;
  return bodyWeightOnDay(
    fallback.data.map((row) => ({
      date: row.entry_date,
      weightKg: row.weight,
    })),
    day
  );
}
