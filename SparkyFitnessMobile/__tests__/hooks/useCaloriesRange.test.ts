import { renderHook, waitFor } from '@testing-library/react-native';
import { useCaloriesRange } from '../../src/hooks/useCaloriesRange';
import { useNutritionTrends } from '../../src/hooks/useNutritionTrends';
import { fetchNutritionTrends } from '../../src/services/api/reportsApi';
import { fetchGoalsRange } from '../../src/services/api/goalsApi';
import { nutritionTrendsQueryKey } from '../../src/hooks/queryKeys';
import { addDays, getTodayDate } from '../../src/utils/dateUtils';
import {
  createTestQueryClient,
  createQueryWrapper,
  type QueryClient,
} from './queryTestUtils';

jest.mock('../../src/services/api/reportsApi', () => ({
  fetchNutritionTrends: jest.fn(),
}));

jest.mock('../../src/services/api/goalsApi', () => ({
  fetchGoalsRange: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((callback) => {
    callback();
  }),
}));

const mockFetchNutritionTrends = fetchNutritionTrends as jest.MockedFunction<
  typeof fetchNutritionTrends
>;
const mockFetchGoalsRange = fetchGoalsRange as jest.MockedFunction<
  typeof fetchGoalsRange
>;

const today = getTodayDate();

describe('useCaloriesRange', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchNutritionTrends.mockResolvedValue([]);
    mockFetchGoalsRange.mockResolvedValue({});
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  test('requests the adjusted goal range for the same window', async () => {
    renderHook(() => useCaloriesRange({ range: '7d' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => {
      expect(mockFetchGoalsRange).toHaveBeenCalledWith(
        addDays(today, -6),
        today,
        true
      );
    });
  });

  test('steps calorieGoals to the resolved value on the day it changed', async () => {
    mockFetchGoalsRange.mockResolvedValue({
      [addDays(today, -2)]: { calories: 1800 } as never,
      [addDays(today, -1)]: { calories: 2000 } as never,
      [today]: { calories: 2000 } as never,
    });

    const { result } = renderHook(() => useCaloriesRange({ range: '7d' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const { calorieGoals } = result.current;
    expect(calorieGoals).toHaveLength(7);
    expect(calorieGoals[4]).toBe(1800); // addDays(today, -2)
    expect(calorieGoals[5]).toBe(2000); // addDays(today, -1)
    expect(calorieGoals[6]).toBe(2000); // today
  });

  test('resolves a day missing from the goals response to null', async () => {
    mockFetchGoalsRange.mockResolvedValue({
      [today]: { calories: 2000 } as never,
    });

    const { result } = renderHook(() => useCaloriesRange({ range: '7d' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.calorieGoals[0]).toBeNull();
    expect(result.current.calorieGoals[6]).toBe(2000);
  });

  test('zero-fills a day the server did not return', async () => {
    const threeDaysAgo = addDays(today, -3);
    mockFetchNutritionTrends.mockResolvedValue([
      {
        date: threeDaysAgo,
        calories: 2000,
        protein: 150,
        carbs: 200,
        fat: 70,
        saturated_fat: 0,
        polyunsaturated_fat: 0,
        monounsaturated_fat: 0,
        trans_fat: 0,
        cholesterol: 0,
        sodium: 0,
        potassium: 0,
        dietary_fiber: 30,
        sugars: 0,
        vitamin_a: 0,
        vitamin_c: 0,
        calcium: 0,
        iron: 0,
        caffeine_mg: 0,
        water_ml: 0,
        alcohol_g: 0,
      },
    ]);

    const { result } = renderHook(() => useCaloriesRange({ range: '7d' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const todayPoint = result.current.caloriesData.find(
      (point) => point.day === today
    );
    expect(todayPoint).toEqual({
      day: today,
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    });

    const loggedPoint = result.current.caloriesData.find(
      (point) => point.day === threeDaysAgo
    );
    expect(loggedPoint).toEqual({
      day: threeDaysAgo,
      calories: 2000,
      protein: 150,
      carbs: 200,
      fat: 70,
    });
  });

  test('shares its cached fetch with useNutritionTrends for the same window', async () => {
    const { result: caloriesResult } = renderHook(
      () => useCaloriesRange({ range: '7d' }),
      { wrapper: createQueryWrapper(queryClient) }
    );
    const { result: trendsResult } = renderHook(
      () => useNutritionTrends({ range: '7d' }),
      { wrapper: createQueryWrapper(queryClient) }
    );

    await waitFor(() => {
      expect(caloriesResult.current.isLoading).toBe(false);
      expect(trendsResult.current.isLoading).toBe(false);
    });

    expect(mockFetchNutritionTrends).toHaveBeenCalledTimes(1);
    expect(mockFetchNutritionTrends).toHaveBeenCalledWith(
      addDays(today, -6),
      today
    );
    expect(
      queryClient.getQueryData(
        nutritionTrendsQueryKey(addDays(today, -6), today)
      )
    ).toBeDefined();
  });

  test('issues no goals request when disabled', async () => {
    renderHook(() => useCaloriesRange({ range: '7d', enabled: false }), {
      wrapper: createQueryWrapper(queryClient),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockFetchGoalsRange).not.toHaveBeenCalled();
  });
});
