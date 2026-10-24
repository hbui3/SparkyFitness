jest.mock('@kingstinct/react-native-healthkit', () => ({
  requestAuthorization: jest.fn().mockResolvedValue(true),
  getRequestStatusForAuthorization: jest.fn(),
  AuthorizationRequestStatus: { unknown: 0, shouldRequest: 1, unnecessary: 2 },
  isHealthDataAvailable: jest.fn().mockResolvedValue(true),
  queryQuantitySamples: jest.fn(),
  queryStatisticsCollectionForQuantity: jest.fn(),
  queryCategorySamples: jest.fn(),
  queryWorkoutSamples: jest.fn(),
  queryCorrelationSamples: jest.fn(),
}));
jest.mock('../../../src/services/appleHeartZones', () => ({
  readAppleWorkoutZoneGroups: jest.fn(),
}));
jest.mock('../../../src/services/LogService', () => ({ addLog: jest.fn() }));
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Alert: { alert: jest.fn() },
}));

import {
  hasUnrequestedHealthPermissions,
  initHealthConnect,
  requestHealthPermissions,
} from '../../../src/services/healthkit/index';
import {
  AuthorizationRequestStatus,
  getRequestStatusForAuthorization,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';

const statusMock = getRequestStatusForAuthorization as jest.Mock;
const nutrition = [
  { accessType: 'read', recordType: 'Nutrition' },
] as Parameters<typeof hasUnrequestedHealthPermissions>[0];

beforeAll(async () => {
  await initHealthConnect();
});

beforeEach(() => {
  statusMock.mockReset();
});

describe('hasUnrequestedHealthPermissions', () => {
  // A type added to a metric in an app update (caffeine in Nutrition) is never
  // asked for on existing installs unless the check covers the same types the
  // request does.
  it('checks the same HealthKit types the request asks for', async () => {
    statusMock.mockResolvedValue(AuthorizationRequestStatus.unnecessary);
    (requestAuthorization as jest.Mock).mockClear();

    await hasUnrequestedHealthPermissions(nutrition);
    await requestHealthPermissions(nutrition);

    const checked = statusMock.mock.calls[0][0];
    expect(checked.toRead).toContain('HKQuantityTypeIdentifierDietaryCaffeine');
    expect(checked).toEqual(
      (requestAuthorization as jest.Mock).mock.calls[0][0]
    );
  });

  it.each([
    ['shouldRequest', true],
    ['unknown', true],
    ['unnecessary', false],
  ] as const)('returns %s -> %s', async (status, expected) => {
    statusMock.mockResolvedValue(AuthorizationRequestStatus[status]);

    await expect(hasUnrequestedHealthPermissions(nutrition)).resolves.toBe(
      expected
    );
  });

  it('asks again when the check fails', async () => {
    statusMock.mockRejectedValue(new Error('boom'));

    await expect(hasUnrequestedHealthPermissions(nutrition)).resolves.toBe(
      true
    );
  });

  it('does not check when nothing is enabled', async () => {
    await expect(hasUnrequestedHealthPermissions([])).resolves.toBe(false);
    expect(statusMock).not.toHaveBeenCalled();
  });
});
