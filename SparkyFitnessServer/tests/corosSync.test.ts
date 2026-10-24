import { vi, beforeEach, describe, expect, it } from 'vitest';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const MOCK_SPORT_PAYLOAD = {
  content: [
    {
      type: 'text',
      text: 'Sport Records — 2024-12-01 to 2024-12-31 (1 records)\n========================\n\n1. Indoor Run — 2024-12-21\n   Location: Indoor Run\n   Time Window: startTimestamp=1734814685 | endTimestamp=1734816535\n   Duration: 30:16 | Distance: 3.74 km\n   Average Pace: 8:05 /km | Avg HR: 134 bpm | Calories: 300 kcal\n   LabelId: 480644884506640590 | SportType: 101',
    },
  ],
  isError: false,
};

const MOCK_FIT_PAYLOAD = {
  content: [
    {
      type: 'text',
      text: 'Returned raw FIT file(s).',
    },
    {
      type: 'resource',
      resource: {
        uri: 'coros://activity-fit-files/480644884506640590.fit',
        mimeType: 'application/octet-stream',
        _meta: {
          labelId: '480644884506640590',
          sportType: 101,
          fileName: '480644884506640590.fit',
          fileType: 4,
        },
        blob: Buffer.from('mock-fit-data').toString('base64'),
      },
    },
  ],
  isError: false,
};

const mockDb = {
  query: vi.fn(),
  release: vi.fn(),
};

vi.mock('../db/poolManager.js', () => ({
  getSystemClient: vi.fn(async () => mockDb),
  getClient: vi.fn(async () => mockDb),
}));

vi.mock('../config/db.js', () => ({
  default: mockDb,
}));

vi.mock('../config/logging.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
}));

const mockCorosIntegration = {
  withCorosMcp: vi.fn(),
  getValidAccessToken: vi.fn(),
};

vi.mock('../integrations/coros/corosService.js', () => ({
  default: mockCorosIntegration,
}));

const mockDataProcessor = {
  importCorosActivityFromFit: vi.fn(),
  importCorosActivitySummary: vi.fn(),
};

vi.mock('../integrations/coros/corosDataProcessor.js', () => mockDataProcessor);

const mockExerciseEntry = {
  getExistingSourceIds: vi.fn(),
};

vi.mock('../models/exerciseEntry.js', () => mockExerciseEntry);

const { syncCorosData } = await import('../services/corosService.js');

describe('corosService syncCorosData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExerciseEntry.getExistingSourceIds.mockResolvedValue(new Set());
    mockDb.query.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('external_data_providers')) {
        return {
          rows: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              base_url: 'https://mcpus.coros.com/mcp',
              client_id: 'test-client',
              provider_type: 'coros_mcp',
              is_active: true,
              encrypted_access_token: 'enc-token',
            },
          ],
        };
      }
      return { rows: [] };
    });
  });

  it('handles empty activity list gracefully', async () => {
    mockCorosIntegration.withCorosMcp.mockImplementation(
      async (_userId, _providerId, fn) => {
        const mockCall = vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"data": {"dataList": []}}' }],
        });
        return fn(mockCall);
      }
    );

    const result = await syncCorosData(
      USER_ID,
      'manual',
      null,
      '2026-09-01',
      '2026-09-27'
    );

    expect(result.success).toBe(true);
    expect(result.imported).toBe(0);
  });

  it('downloads FIT files and imports activities with telemetry', async () => {
    mockCorosIntegration.withCorosMcp.mockImplementation(
      async (_userId, _providerId, fn) => {
        const mockCall = vi.fn().mockImplementation(async (name) => {
          if (
            name === 'coros_query_sport_data' ||
            name === 'querySportRecords'
          ) {
            return MOCK_SPORT_PAYLOAD;
          }
          if (
            name === 'downloadActivityFitFiles' ||
            name === 'downloadFitFile' ||
            name === 'coros_download_fit_file'
          ) {
            return MOCK_FIT_PAYLOAD;
          }
          return { content: [{ type: 'text', text: '{}' }] };
        });
        return fn(mockCall);
      }
    );

    mockDataProcessor.importCorosActivityFromFit.mockResolvedValue({
      status: 'created',
    });

    const result = await syncCorosData(
      USER_ID,
      'manual',
      null,
      '2024-12-01',
      '2024-12-31'
    );

    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
    expect(mockDataProcessor.importCorosActivityFromFit).toHaveBeenCalledTimes(
      1
    );
  });

  it('skips activities that were already imported', async () => {
    mockExerciseEntry.getExistingSourceIds.mockResolvedValue(
      new Set(['480644884506640590'])
    );

    mockCorosIntegration.withCorosMcp.mockImplementation(
      async (_userId, _providerId, fn) => {
        const mockCall = vi.fn().mockResolvedValue(MOCK_SPORT_PAYLOAD);
        return fn(mockCall);
      }
    );

    const result = await syncCorosData(
      USER_ID,
      'manual',
      null,
      '2024-12-01',
      '2024-12-31'
    );

    expect(result.success).toBe(true);
    expect(result.imported).toBe(0);
    expect(mockDataProcessor.importCorosActivityFromFit).not.toHaveBeenCalled();
  });
});
