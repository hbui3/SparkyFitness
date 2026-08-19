import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  getActivitiesPage: vi.fn(),
  getActivityDownloadUrl: vi.fn(),
  downloadFitFile: vi.fn(),
  getCredentials: vi.fn(),
  getStatus: vi.fn(),
  updateLastSync: vi.fn(),
  importFitFiles: vi.fn(),
  loadTimezone: vi.fn(),
}));

vi.mock('../integrations/igpsport/igpsportApiClient.js', () => ({
  IGPSportApiClient: vi.fn(function IGPSportApiClientMock() {
    return {
      login: mocks.login,
      getActivitiesPage: mocks.getActivitiesPage,
      getActivityDownloadUrl: mocks.getActivityDownloadUrl,
      downloadFitFile: mocks.downloadFitFile,
    };
  }),
}));

vi.mock('../integrations/igpsport/igpsportRepository.js', () => ({
  getIGPSportProviderCredentials: mocks.getCredentials,
  getIGPSportProviderStatus: mocks.getStatus,
  updateIGPSportLastSync: mocks.updateLastSync,
}));

vi.mock('../services/fitImportService.js', () => ({
  default: { importFitFiles: mocks.importFitFiles },
}));

vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: mocks.loadTimezone,
}));

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

import { syncIGPSportData } from '../integrations/igpsport/igpsportService.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadTimezone.mockResolvedValue('Europe/Berlin');
  mocks.getCredentials.mockResolvedValue({
    providerId: 'provider-1',
    username: 'rider@example.com',
    password: 'local-password',
    region: 'Global',
    lastSyncAt: null,
  });
  mocks.getActivitiesPage.mockResolvedValue({
    activities: [
      {
        rideId: 'ride-42',
        title: 'Evening Ride',
        startTime: '2026-08-18 18:00:00',
        productName: 'iGS800',
      },
    ],
    page: 1,
    totalPages: 1,
    totalRows: 1,
  });
  mocks.getActivityDownloadUrl.mockResolvedValue(
    'https://activity-files.example.net/ride-42.fit'
  );
  mocks.downloadFitFile.mockResolvedValue(Buffer.from([1, 2, 3]));
  mocks.importFitFiles.mockResolvedValue({
    message: 'Imported 1 of 1 FIT file(s).',
    created: 1,
    updated: 0,
    failed: 0,
    results: [],
  });
});

describe('syncIGPSportData', () => {
  it('downloads original FIT activities and imports them with iGPSPORT provenance', async () => {
    const response = await syncIGPSportData('user-1', 'actor-1', {
      providerId: 'provider-1',
      fullSync: true,
    });

    expect(mocks.login).toHaveBeenCalledWith(
      'rider@example.com',
      'local-password'
    );
    expect(mocks.getActivitiesPage).toHaveBeenCalledWith(
      '2010-01-01',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      1
    );
    expect(mocks.getActivityDownloadUrl).toHaveBeenCalledWith('ride-42');
    expect(mocks.importFitFiles).toHaveBeenCalledWith(
      'user-1',
      'actor-1',
      [
        {
          originalname: 'igpsport-ride-42.fit',
          buffer: Buffer.from([1, 2, 3]),
          sourceId: 'ride-42',
          activityName: 'Evening Ride',
        },
      ],
      {
        entrySource: 'iGPSPORT',
        detailProviderName: 'iGPSPORT',
        exerciseSource: 'igpsport',
        notesPrefix: 'iGPSPORT FIT Import',
      }
    );
    expect(mocks.updateLastSync).toHaveBeenCalledWith(
      'user-1',
      'provider-1',
      expect.any(Date)
    );
    expect(response).toMatchObject({
      success: true,
      createdActivities: 1,
      updatedActivities: 0,
      failedActivities: 0,
      startDate: '2010-01-01',
    });
  });

  it('continues after one activity download fails and reports the failure', async () => {
    mocks.getActivitiesPage.mockResolvedValueOnce({
      activities: [
        {
          rideId: 'broken',
          title: 'Broken Ride',
          startTime: '',
          productName: null,
        },
        {
          rideId: 'working',
          title: 'Working Ride',
          startTime: '',
          productName: null,
        },
      ],
      page: 1,
      totalPages: 1,
      totalRows: 2,
    });
    mocks.getActivityDownloadUrl
      .mockRejectedValueOnce(new Error('download URL unavailable'))
      .mockResolvedValueOnce('https://activity-files.example.net/working.fit');

    const response = await syncIGPSportData('user-1', 'actor-1', {
      fullSync: false,
    });

    expect(mocks.importFitFiles).toHaveBeenCalledTimes(1);
    expect(response).toMatchObject({
      createdActivities: 1,
      updatedActivities: 0,
      failedActivities: 1,
    });
  });
});
