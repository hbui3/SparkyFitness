import { act, renderHook } from '@testing-library/react-native';

import { useRetryLabelScan } from '../../src/hooks/useRetryLabelScan';
import {
  rememberLabelScan,
  getLabelScanPhoto,
} from '../../src/services/labelScanSession';
import { useAppPreferencesStore } from '../../src/stores/appPreferencesStore';
import { scanNutritionLabel } from '../../src/services/api/externalFoodSearchApi';
import { scanLabelOnDevice } from '../../src/services/onDeviceLabelScan';

jest.mock('../../src/services/api/externalFoodSearchApi', () => ({
  scanNutritionLabel: jest.fn(),
}));
let mockAvailable = true;
jest.mock('../../src/services/onDeviceLabelScan', () => ({
  scanLabelOnDevice: jest.fn(),
  isOnDeviceLabelScanAvailable: () => mockAvailable,
}));
jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

const result = {
  name: 'Granola',
  brand: 'Acme',
  serving_size: 40,
  serving_unit: 'g',
  calories: 180,
  protein: 4,
  carbs: 26,
  fat: 7,
};

const navigation = { replace: jest.fn() };
const params = (source: 'device' | 'server') =>
  ({
    mode: 'create-food',
    date: '2026-10-05',
    labelScanSource: source,
    providerType: 'label_scan',
  }) as never;

describe('useRetryLabelScan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAvailable = true;
    useAppPreferencesStore.setState({ onDeviceLabelScanEnabled: true });
  });

  it('offers the server AI after the phone read the label', () => {
    rememberLabelScan('b64', 'device');
    const { result: hook } = renderHook(() =>
      useRetryLabelScan(params('device'), navigation as never)
    );
    expect(hook.current.canRetry).toBe(true);
  });

  it('reads the same photo with the server AI and replaces the form', async () => {
    rememberLabelScan('b64', 'device');
    (scanNutritionLabel as jest.Mock).mockResolvedValue(result);
    const { result: hook } = renderHook(() =>
      useRetryLabelScan(params('device'), navigation as never)
    );

    await act(async () => {
      hook.current.retry();
    });

    expect(scanNutritionLabel).toHaveBeenCalledWith('b64', 'image/jpeg');
    expect(navigation.replace).toHaveBeenCalledWith(
      'FoodForm',
      expect.objectContaining({
        mode: 'create-food',
        date: '2026-10-05',
        labelScanSource: 'server',
        initialFood: expect.objectContaining({
          name: 'Granola',
          calories: '180',
        }),
      })
    );
  });

  it('offers the phone after the server read the label only where it can run', () => {
    rememberLabelScan('b64', 'server');
    mockAvailable = false;
    const unavailable = renderHook(() =>
      useRetryLabelScan(params('server'), navigation as never)
    );
    expect(unavailable.result.current.canRetry).toBe(false);

    mockAvailable = true;
    useAppPreferencesStore.setState({ onDeviceLabelScanEnabled: false });
    const off = renderHook(() =>
      useRetryLabelScan(params('server'), navigation as never)
    );
    expect(off.result.current.canRetry).toBe(false);

    useAppPreferencesStore.setState({ onDeviceLabelScanEnabled: true });
    const on = renderHook(() =>
      useRetryLabelScan(params('server'), navigation as never)
    );
    expect(on.result.current.canRetry).toBe(true);
  });

  it('keeps the form when the phone cannot read the label', async () => {
    rememberLabelScan('b64', 'server');
    (scanLabelOnDevice as jest.Mock).mockResolvedValue(null);
    const { result: hook } = renderHook(() =>
      useRetryLabelScan(params('server'), navigation as never)
    );

    await act(async () => {
      hook.current.retry();
    });

    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('ignores a retry that finishes after a newer scan', async () => {
    rememberLabelScan('old', 'device');
    let release: (value: unknown) => void = () => {};
    (scanNutritionLabel as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const { result: hook } = renderHook(() =>
      useRetryLabelScan(params('device'), navigation as never)
    );

    act(() => {
      hook.current.retry();
    });
    rememberLabelScan('newer', 'server');
    await act(async () => {
      release(result);
    });

    expect(navigation.replace).not.toHaveBeenCalled();
    expect(getLabelScanPhoto()).toBe('newer');
  });

  it('keeps the form when the server read fails', async () => {
    rememberLabelScan('b64', 'device');
    (scanNutritionLabel as jest.Mock).mockRejectedValue(new Error('boom'));
    const { result: hook } = renderHook(() =>
      useRetryLabelScan(params('device'), navigation as never)
    );

    await act(async () => {
      hook.current.retry();
    });

    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
