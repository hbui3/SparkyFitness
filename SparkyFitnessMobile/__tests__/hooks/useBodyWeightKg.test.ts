import { renderHook, waitFor } from '@testing-library/react-native';
import { useBodyWeightKg } from '../../src/hooks/useBodyWeightKg';
import {
  fetchLatestCheckInMeasurementsOnOrBefore,
  fetchMeasurementsRange,
} from '../../src/services/api/measurementsApi';
import { addDays, getTodayDate } from '../../src/utils/dateUtils';
import {
  createTestQueryClient,
  createQueryWrapper,
  type QueryClient,
} from './queryTestUtils';

jest.mock('../../src/services/api/measurementsApi', () => ({
  fetchLatestCheckInMeasurementsOnOrBefore: jest.fn(),
  fetchMeasurementsRange: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}));

jest.mock('../../src/services/LogService', () => ({
  addLog: jest.fn(),
}));

const mockLatest =
  fetchLatestCheckInMeasurementsOnOrBefore as jest.MockedFunction<
    typeof fetchLatestCheckInMeasurementsOnOrBefore
  >;
const mockRange = fetchMeasurementsRange as jest.MockedFunction<
  typeof fetchMeasurementsRange
>;

describe('useBodyWeightKg', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  it('uses the newest weight on or before the day and skips the later lookup', async () => {
    mockLatest.mockResolvedValue({ weight: 80 } as never);
    const { result } = renderHook(() => useBodyWeightKg('2020-01-01', true), {
      wrapper: createQueryWrapper(queryClient),
    });
    await waitFor(() => expect(result.current).toBe(80));
    expect(mockRange).not.toHaveBeenCalled();
  });

  it('uses the earliest later check-in when nothing is on or before the day', async () => {
    mockLatest.mockResolvedValue({ weight: null } as never);
    mockRange.mockResolvedValue([
      { entry_date: '2020-06-01', weight: 82 },
      { entry_date: '2020-03-01', weight: 75 },
      { entry_date: '2020-03-01', weight: 0 },
    ] as never);
    const { result } = renderHook(() => useBodyWeightKg('2020-01-01', true), {
      wrapper: createQueryWrapper(queryClient),
    });
    await waitFor(() => expect(result.current).toBe(75));
    expect(mockRange).toHaveBeenCalledWith(
      addDays('2020-01-01', 1),
      getTodayDate()
    );
  });

  it('does not look later when the on-or-before lookup fails', async () => {
    mockLatest.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useBodyWeightKg('2020-01-01', true), {
      wrapper: createQueryWrapper(queryClient),
    });
    await waitFor(() => expect(mockLatest).toHaveBeenCalled());
    expect(result.current).toBeNull();
    expect(mockRange).not.toHaveBeenCalled();
  });

  it('asks for nothing when disabled', () => {
    const { result } = renderHook(() => useBodyWeightKg('2020-01-01', false), {
      wrapper: createQueryWrapper(queryClient),
    });
    expect(result.current).toBeNull();
    expect(mockLatest).not.toHaveBeenCalled();
    expect(mockRange).not.toHaveBeenCalled();
  });
});
