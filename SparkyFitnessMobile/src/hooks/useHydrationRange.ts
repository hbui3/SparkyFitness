import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchWaterIntakeRange } from '../services/api/measurementsApi';
import { fetchGoalsRange } from '../services/api/goalsApi';
import { useRefetchOnFocus } from './useRefetchOnFocus';
import { waterIntakeRangeQueryKey, goalsRangeQueryKey } from './queryKeys';
import { getTodayDate, addDays } from '../utils/dateUtils';
import {
  RANGE_DAYS,
  type HealthTrendDateRange,
  type HydrationDataPoint,
} from '../types/healthTrends';

interface UseHydrationRangeOptions {
  range: HealthTrendDateRange;
  enabled?: boolean;
}

export function useHydrationRange({
  range,
  enabled = true,
}: UseHydrationRangeOptions) {
  const today = getTodayDate();
  const days = RANGE_DAYS[range];
  const startDate = addDays(today, -(days - 1));

  const {
    data,
    isLoading,
    isError,
    refetch: refetchData,
  } = useQuery({
    queryKey: waterIntakeRangeQueryKey(startDate, today),
    queryFn: () => fetchWaterIntakeRange(startDate, today),
    enabled,
    select: (entries) => {
      const millilitersByDay = new Map<string, number>();
      for (const entry of entries) {
        millilitersByDay.set(entry.entry_date, entry.water_ml);
      }

      // A day with no logged water genuinely means zero drunk, so every day in the
      // window gets a bar rather than being omitted the way a missing weigh-in is.
      const hydrationData: HydrationDataPoint[] = [];
      for (let dayOffset = 0; dayOffset < days; dayOffset++) {
        const day = addDays(today, -(days - 1 - dayOffset));
        hydrationData.push({
          day,
          milliliters: millilitersByDay.get(day) ?? 0,
        });
      }

      return hydrationData;
    },
  });

  useRefetchOnFocus(refetchData, enabled);

  // Raw (unadjusted) goal, matching the same value the Dashboard's selected-date
  // hydration widget already reads (`goals.water_goal_ml`, not the adjusted figure).
  const { data: hydrationGoals, refetch: refetchGoals } = useQuery({
    queryKey: goalsRangeQueryKey(startDate, today, false),
    queryFn: () => fetchGoalsRange(startDate, today, false),
    enabled,
    select: (goalsByDay) => {
      const resolvedGoals: (number | null)[] = [];
      for (let dayOffset = 0; dayOffset < days; dayOffset++) {
        const day = addDays(today, -(days - 1 - dayOffset));
        const dailyGoals = goalsByDay[day];
        resolvedGoals.push(
          dailyGoals ? (dailyGoals.water_goal_ml ?? null) : null
        );
      }
      return resolvedGoals;
    },
  });

  useRefetchOnFocus(refetchGoals, enabled);

  const refetch = useCallback(async () => {
    await Promise.all([refetchData(), refetchGoals()]);
  }, [refetchData, refetchGoals]);

  return {
    hydrationData: data ?? [],
    hydrationGoals: hydrationGoals ?? [],
    isLoading,
    isError,
    refetch,
  };
}
