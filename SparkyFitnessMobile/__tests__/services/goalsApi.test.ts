import {
  fetchDailyGoals,
  fetchGoalsRange,
} from '../../src/services/api/goalsApi';
import {
  getActiveServerConfig,
  ServerConfig,
} from '../../src/services/storage';

jest.mock('../../src/services/storage', () => ({
  getActiveServerConfig: jest.fn(),
  proxyHeadersToRecord: jest.requireActual('../../src/services/storage')
    .proxyHeadersToRecord,
}));

jest.mock('../../src/services/LogService', () => ({
  addLog: jest.fn(),
}));

const mockGetActiveServerConfig = getActiveServerConfig as jest.MockedFunction<
  typeof getActiveServerConfig
>;

describe('goalsApi', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = mockFetch;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('fetchDailyGoals', () => {
    const testConfig: ServerConfig = {
      id: 'test-id',
      url: 'https://example.com',
      apiKey: 'test-api-key-12345',
    };

    const testDate = '2024-06-15';

    test('throws error when no server config exists', async () => {
      mockGetActiveServerConfig.mockResolvedValue(null);

      await expect(fetchDailyGoals(testDate)).rejects.toThrow(
        'Server configuration not found.'
      );
    });

    test('sends GET request to /api/goals/for-date with correct date param', async () => {
      mockGetActiveServerConfig.mockResolvedValue(testConfig);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ calories: 2000, protein: 150 }),
      });

      await fetchDailyGoals(testDate);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api/goals/for-date?date=2024-06-15',
        expect.objectContaining({
          method: 'GET',
          headers: {
            Authorization: 'Bearer test-api-key-12345',

            'X-Meal-Model-Version': '2',
          },
        })
      );
    });

    test('removes trailing slash from URL before making request', async () => {
      mockGetActiveServerConfig.mockResolvedValue({
        ...testConfig,
        url: 'https://example.com/',
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ calories: 2000 }),
      });

      await fetchDailyGoals(testDate);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api/goals/for-date?date=2024-06-15',
        expect.anything()
      );
    });

    test('returns parsed JSON response on success', async () => {
      const responseData = {
        calories: 2000,
        protein: 150,
        carbs: 200,
        fat: 60,
        dietary_fiber: 30,
      };
      mockGetActiveServerConfig.mockResolvedValue(testConfig);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(responseData),
      });

      const result = await fetchDailyGoals(testDate);

      expect(result).toEqual(responseData);
    });

    test('throws error on non-OK response', async () => {
      mockGetActiveServerConfig.mockResolvedValue(testConfig);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(fetchDailyGoals(testDate)).rejects.toThrow(
        'Server error: 500 - Internal Server Error'
      );
    });

    test('rethrows on network failure', async () => {
      mockGetActiveServerConfig.mockResolvedValue(testConfig);
      mockFetch.mockRejectedValue(new Error('Network request failed'));

      await expect(fetchDailyGoals(testDate)).rejects.toThrow(
        'Network request failed'
      );
    });
  });

  describe('fetchGoalsRange', () => {
    const testConfig: ServerConfig = {
      id: 'test-id',
      url: 'https://example.com',
      apiKey: 'test-api-key-12345',
    };

    const startDate = '2026-09-01';
    const endDate = '2026-09-07';

    test('sends GET request with date, end_date and adjust=true params', async () => {
      mockGetActiveServerConfig.mockResolvedValue(testConfig);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await fetchGoalsRange(startDate, endDate, true);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api/goals/for-date?date=2026-09-01&end_date=2026-09-07&adjust=true',
        expect.anything()
      );
    });

    test('sends adjust=false when the caller asks for the raw goal', async () => {
      mockGetActiveServerConfig.mockResolvedValue(testConfig);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await fetchGoalsRange(startDate, endDate, false);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api/goals/for-date?date=2026-09-01&end_date=2026-09-07&adjust=false',
        expect.anything()
      );
    });

    test('returns the parsed per-day goals map on success', async () => {
      const responseData = {
        '2026-09-01': { calories: 1800, water_goal_ml: 2000 },
        '2026-09-07': { calories: 2000, water_goal_ml: 2500 },
      };
      mockGetActiveServerConfig.mockResolvedValue(testConfig);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(responseData),
      });

      const result = await fetchGoalsRange(startDate, endDate, true);

      expect(result).toEqual(responseData);
    });
  });
});
