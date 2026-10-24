import { renderHook } from '@testing-library/react-native';
import { useBackgroundWaterSync } from '../../src/hooks/useBackgroundWaterSync';
import { syncBackgroundWater } from '../../src/services/backgroundWater';
import { usePreferences } from '../../src/hooks/usePreferences';

jest.mock('../../src/services/backgroundWater', () => ({
  syncBackgroundWater: jest.fn().mockResolvedValue(undefined),
  onAppBecameActive: jest.fn(() => () => {}),
}));
jest.mock('../../src/hooks/usePreferences', () => ({
  usePreferences: jest.fn(),
}));

const container = {
  id: 'c1',
  name: 'Bottle',
  volume: 500,
  unit: 'ml',
  servings_per_container: 1,
};

describe('useBackgroundWaterSync', () => {
  beforeEach(() => jest.clearAllMocks());

  test('waits for preferences before writing the native copy', () => {
    jest
      .mocked(usePreferences)
      .mockReturnValue({ preferences: undefined } as never);

    renderHook(() => useBackgroundWaterSync(container as never));

    expect(syncBackgroundWater).not.toHaveBeenCalled();
  });

  test('syncs with the weight unit once preferences load', () => {
    jest.mocked(usePreferences).mockReturnValue({
      preferences: { default_weight_unit: 'lbs' },
    } as never);

    renderHook(() => useBackgroundWaterSync(container as never));

    expect(syncBackgroundWater).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1' }),
      'lbs'
    );
  });
});
