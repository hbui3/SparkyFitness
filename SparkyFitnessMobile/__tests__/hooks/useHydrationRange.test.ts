import { renderHook, waitFor } from '@testing-library/react-native';
import { useHydrationRange } from '../../src/hooks/useHydrationRange';
import { waterIntakeRangeQueryKey } from '../../src/hooks/queryKeys';
import { fetchWaterIntakeRange } from '../../src/services/api/measurementsApi';
import { fetchGoalsRange } from '../../src/services/api/goalsApi';
import { addDays, getTodayDate } from '../../src/utils/dateUtils';
import {
  createTestQueryClient,
  createQueryWrapper,
  type QueryClient,
} from './queryTestUtils';

jest.mock('../../src/services/api/measurementsApi', () => ({
  fetchWaterIntakeRange: jest.fn(),
}));

jest.mock('../../src/services/api/goalsApi', () => ({
  fetchGoalsRange: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((callback) => {
    callback();
  }),
}));

const mockFetchWaterIntakeRange = fetchWaterIntakeRange as jest.MockedFunction<
  typeof fetchWaterIntakeRange
>;
const mockFetchGoalsRange = fetchGoalsRange as jest.MockedFunction<
  typeof fetchGoalsRange
>;

const today = getTodayDate();

describe('useHydrationRange', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchWaterIntakeRange.mockResolvedValue([]);
    mockFetchGoalsRange.mockResolvedValue({});
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  test('emits one point per day for a 7d window', async () => {
    const { result } = renderHook(() => useHydrationRange({ range: '7d' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hydrationData).toHaveLength(7);
  });

  test('zero-fills days the server did not return', async () => {
    // A day with no logged water genuinely means zero drunk, so it gets a bar rather
    // than being omitted the way a missing weigh-in is.
    mockFetchWaterIntakeRange.mockResolvedValue([
      { entry_date: today, water_ml: 1500 },
    ]);

    const { result } = renderHook(() => useHydrationRange({ range: '7d' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const zeroDays = result.current.hydrationData.filter(
      (point) => point.milliliters === 0
    );
    expect(zeroDays).toHaveLength(6);
    expect(
      result.current.hydrationData.find((point) => point.day === today)
        ?.milliliters
    ).toBe(1500);
  });

  test('orders points chronologically ascending, ending today', async () => {
    const { result } = renderHook(() => useHydrationRange({ range: '7d' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const data = result.current.hydrationData;
    expect(data[0].day).toBe(addDays(today, -6));
    expect(data[6].day).toBe(today);
    for (let index = 1; index < data.length; index++) {
      expect(data[index].day > data[index - 1].day).toBe(true);
    }
  });

  test('requests the window matching the selected range', async () => {
    renderHook(() => useHydrationRange({ range: '30d' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => {
      expect(mockFetchWaterIntakeRange).toHaveBeenCalledWith(
        addDays(today, -29),
        today
      );
    });
  });

  test('caches the response under waterIntakeRangeQueryKey', async () => {
    const response = [{ entry_date: today, water_ml: 750 }];
    mockFetchWaterIntakeRange.mockResolvedValue(response);

    const { result } = renderHook(() => useHydrationRange({ range: '7d' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(
      queryClient.getQueryData(
        waterIntakeRangeQueryKey(addDays(today, -6), today)
      )
    ).toEqual(response);
  });

  test('issues no request when disabled', async () => {
    const { result } = renderHook(
      () => useHydrationRange({ range: '7d', enabled: false }),
      { wrapper: createQueryWrapper(queryClient) }
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockFetchWaterIntakeRange).not.toHaveBeenCalled();
    expect(mockFetchGoalsRange).not.toHaveBeenCalled();
    expect(result.current.hydrationData).toEqual([]);
  });

  test('requests the raw (unadjusted) goal range for the same window', async () => {
    renderHook(() => useHydrationRange({ range: '7d' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => {
      expect(mockFetchGoalsRange).toHaveBeenCalledWith(
        addDays(today, -6),
        today,
        false
      );
    });
  });

  test('steps hydrationGoals to the resolved value on the day it changed', async () => {
    mockFetchGoalsRange.mockResolvedValue({
      [addDays(today, -2)]: { water_goal_ml: 2000 } as never,
      [addDays(today, -1)]: { water_goal_ml: 2500 } as never,
      [today]: { water_goal_ml: 2500 } as never,
    });

    const { result } = renderHook(() => useHydrationRange({ range: '7d' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const { hydrationGoals } = result.current;
    expect(hydrationGoals).toHaveLength(7);
    expect(hydrationGoals[4]).toBe(2000); // addDays(today, -2)
    expect(hydrationGoals[5]).toBe(2500); // addDays(today, -1)
    expect(hydrationGoals[6]).toBe(2500); // today
  });

  test('resolves a day missing from the goals response to null', async () => {
    mockFetchGoalsRange.mockResolvedValue({
      [today]: { water_goal_ml: 2500 } as never,
    });

    const { result } = renderHook(() => useHydrationRange({ range: '7d' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hydrationGoals[0]).toBeNull();
    expect(result.current.hydrationGoals[6]).toBe(2500);
  });
});
