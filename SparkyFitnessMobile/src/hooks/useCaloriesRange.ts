import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchNutritionTrends } from '../services/api/reportsApi';
import { fetchGoalsRange } from '../services/api/goalsApi';
import { useRefetchOnFocus } from './useRefetchOnFocus';
import { nutritionTrendsQueryKey, goalsRangeQueryKey } from './queryKeys';
import { getTodayDate, addDays } from '../utils/dateUtils';
import { average } from '../utils/mathUtils';
import {
  RANGE_DAYS,
  type HealthTrendDateRange,
  type CaloriesDataPoint,
} from '../types/healthTrends';

interface UseCaloriesRangeOptions {
  range: HealthTrendDateRange;
  enabled?: boolean;
}

interface CaloriesRangeResult {
  caloriesData: CaloriesDataPoint[];
  /** Mean calories across every day in the window, zero-fill days included -- a day with
   * nothing logged is a real zero (see the comment below), not a missing value to exclude,
   * so it pulls the average down like any other day would. `null` only when the window
   * itself is empty. */
  averageCalories: number | null;
}

/**
 * Shares `nutritionTrendsQueryKey` with `useNutritionTrends` so a Calories page on the
 * Dashboard and a same-window Nutrient Trends screen reuse one cached fetch.
 */
export function useCaloriesRange({
  range,
  enabled = true,
}: UseCaloriesRangeOptions) {
  const today = getTodayDate();
  const days = RANGE_DAYS[range];
  const startDate = addDays(today, -(days - 1));

  const {
    data,
    isLoading,
    isError,
    refetch: refetchData,
  } = useQuery({
    queryKey: nutritionTrendsQueryKey(startDate, today),
    queryFn: () => fetchNutritionTrends(startDate, today),
    enabled,
    select: (entries) => {
      const byDay = new Map(entries.map((entry) => [entry.date, entry]));

      // A day with no logged food genuinely means zero eaten, so every day in the window
      // gets a bar rather than being omitted the way a missing weigh-in is (#1587).
      const caloriesData: CaloriesDataPoint[] = [];
      for (let dayOffset = 0; dayOffset < days; dayOffset++) {
        const day = addDays(today, -(days - 1 - dayOffset));
        const entry = byDay.get(day);
        caloriesData.push({
          day,
          calories: entry?.calories ?? 0,
          protein: entry?.protein ?? 0,
          carbs: entry?.carbs ?? 0,
          fat: entry?.fat ?? 0,
        });
      }

      const averageCalories = average(
        caloriesData.map((point) => point.calories)
      );

      return { caloriesData, averageCalories };
    },
  });

  useRefetchOnFocus(refetchData, enabled);

  // Adjusted (adaptive) goals, matching the same flag the Dashboard's selected-date
  // calorie goal already resolves with.
  const { data: calorieGoals, refetch: refetchGoals } = useQuery({
    queryKey: goalsRangeQueryKey(startDate, today, true),
    queryFn: () => fetchGoalsRange(startDate, today, true),
    enabled,
    select: (goalsByDay) => {
      const resolvedGoals: (number | null)[] = [];
      for (let dayOffset = 0; dayOffset < days; dayOffset++) {
        const day = addDays(today, -(days - 1 - dayOffset));
        const dailyGoals = goalsByDay[day];
        resolvedGoals.push(dailyGoals ? dailyGoals.calories : null);
      }
      return resolvedGoals;
    },
  });

  useRefetchOnFocus(refetchGoals, enabled);

  const refetch = useCallback(async () => {
    await Promise.all([refetchData(), refetchGoals()]);
  }, [refetchData, refetchGoals]);

  const result: CaloriesRangeResult = data ?? {
    caloriesData: [],
    averageCalories: null,
  };

  return {
    ...result,
    calorieGoals: calorieGoals ?? [],
    isLoading,
    isError,
    refetch,
  };
}
