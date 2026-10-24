import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useExerciseDashboard } from '../../src/hooks/useExerciseDashboard';
import { fetchExerciseDashboard } from '../../src/services/api/reportsApi';
import {
  createTestQueryClient,
  createQueryWrapper,
  type QueryClient,
} from './queryTestUtils';

jest.mock('../../src/services/api/reportsApi', () => ({
  fetchExerciseDashboard: jest.fn(),
}));

let mockToday = '2026-09-27';
jest.mock('../../src/utils/dateUtils', () => ({
  ...jest.requireActual('../../src/utils/dateUtils'),
  getTodayDate: () => mockToday,
}));

let mockFocus: (() => void) | undefined;
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((callback: () => void) => {
    mockFocus = callback;
  }),
}));

const mockFetch = fetchExerciseDashboard as jest.MockedFunction<
  typeof fetchExerciseDashboard
>;

describe('useExerciseDashboard', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockToday = '2026-09-27';
    mockFocus = undefined;
    queryClient = createTestQueryClient();
    mockFetch.mockResolvedValue({} as never);
  });

  afterEach(() => {
    queryClient.clear();
  });

  test('requests the range ending today', async () => {
    renderHook(() => useExerciseDashboard('7d'), {
      wrapper: createQueryWrapper(queryClient),
    });
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith('2026-09-21', '2026-09-27')
    );
  });

  test('does not refetch on the focus that opens the screen', async () => {
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useExerciseDashboard('7d'), {
      wrapper: createQueryWrapper(queryClient),
    });
    // The mount fetch is already under way; invalidating would repeat it.
    act(() => mockFocus?.());
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(invalidate).not.toHaveBeenCalled();
  });

  test('refetches the same range when focused again on the same day', async () => {
    const dateNow = jest.spyOn(Date, 'now');
    dateNow.mockReturnValue(0);
    renderHook(() => useExerciseDashboard('7d'), {
      wrapper: createQueryWrapper(queryClient),
    });
    act(() => mockFocus?.());
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    // Past useRefetchOnFocus's 30 s throttle.
    dateNow.mockReturnValue(60_000);
    act(() => mockFocus?.());
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch).toHaveBeenLastCalledWith('2026-09-21', '2026-09-27');
    dateNow.mockRestore();
  });

  test('moves the range forward when focused on a new day', async () => {
    const dateNow = jest.spyOn(Date, 'now');
    dateNow.mockReturnValue(0);
    renderHook(() => useExerciseDashboard('7d'), {
      wrapper: createQueryWrapper(queryClient),
    });
    act(() => mockFocus?.());
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    mockToday = '2026-09-28';
    dateNow.mockReturnValue(60_000);
    act(() => mockFocus?.());

    await waitFor(() =>
      expect(mockFetch).toHaveBeenLastCalledWith('2026-09-22', '2026-09-28')
    );
    dateNow.mockRestore();
  });
});
