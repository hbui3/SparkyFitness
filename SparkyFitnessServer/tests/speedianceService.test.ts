import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  getTrainingRecords: vi.fn(),
  getTrainingInfo: vi.fn(),
  getTrainingDetail: vi.fn(),
  getActionLibraryGroup: vi.fn(),
  getCredentials: vi.fn(),
  updateLastSync: vi.fn(),
  processWorkouts: vi.fn(),
  loadTimezone: vi.fn(),
}));

vi.mock('../integrations/speediance/speedianceApiClient.js', () => ({
  SpeedianceApiClient: vi.fn(function SpeedianceApiClientMock() {
    return {
      login: mocks.login,
      getTrainingRecords: mocks.getTrainingRecords,
      getTrainingInfo: mocks.getTrainingInfo,
      getTrainingDetail: mocks.getTrainingDetail,
      getActionLibraryGroup: mocks.getActionLibraryGroup,
    };
  }),
  SpeedianceAuthenticationError: class SpeedianceAuthenticationError extends Error {},
}));

vi.mock('../integrations/speediance/speedianceRepository.js', () => ({
  getSpeedianceProviderCredentials: mocks.getCredentials,
  getSpeedianceProviderStatus: vi.fn(),
  updateSpeedianceLastSync: mocks.updateLastSync,
}));

vi.mock('../integrations/speediance/speedianceDataProcessor.js', () => ({
  processSpeedianceWorkouts: mocks.processWorkouts,
}));

vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: mocks.loadTimezone,
}));

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

import { syncSpeedianceData } from '../integrations/speediance/speedianceService.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadTimezone.mockResolvedValue('Europe/Berlin');
  mocks.getCredentials.mockResolvedValue({
    providerId: 'provider-1',
    email: 'local@example.com',
    password: 'local-password',
    region: 'EU',
    lastSyncAt: null,
  });
  mocks.getTrainingRecords.mockResolvedValue([
    {
      trainingId: 'training-1',
      title: 'Workout One',
      type: 9,
      startTimestamp: 1_776_500_000,
      trainingTime: 900,
      calorie: 100,
      totalCapacity: 1_000,
    },
    {
      trainingId: 'training-2',
      title: 'Workout Two',
      type: 9,
      startTimestamp: 1_776_600_000,
      trainingTime: 900,
      calorie: 100,
      totalCapacity: 1_000,
    },
  ]);
  mocks.getTrainingInfo.mockResolvedValue({});
  mocks.getTrainingDetail.mockResolvedValue([
    {
      actionLibraryName: 'Chest Press',
      actionLibraryGroupId: 'group-1',
      completionMethod: 1,
      finishedReps: [],
    },
  ]);
  mocks.getActionLibraryGroup.mockResolvedValue({
    mainMuscleGroupList: [{ muscleGroupName: 'Pecs' }],
    auxiliaryMuscleGroupList: [{ muscleGroupName: 'Triceps' }],
  });
  mocks.processWorkouts.mockResolvedValue({
    importedWorkouts: 2,
    importedExercises: 2,
    skippedWorkouts: 0,
  });
});

describe('syncSpeedianceData', () => {
  it('enriches exercises with cached action-library muscle metadata', async () => {
    await syncSpeedianceData('user-1', 'user-1', {
      providerId: 'provider-1',
      fullSync: true,
    });

    expect(mocks.getActionLibraryGroup).toHaveBeenCalledTimes(1);
    expect(mocks.getActionLibraryGroup).toHaveBeenCalledWith('group-1');
    expect(mocks.processWorkouts).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.arrayContaining([
        expect.objectContaining({
          exercises: [
            expect.objectContaining({
              primaryMuscles: ['chest'],
              secondaryMuscles: ['triceps'],
            }),
          ],
        }),
      ]),
      '2018-01-01',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      'Europe/Berlin'
    );
  });
});
