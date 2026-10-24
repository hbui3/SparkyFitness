import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import AiSettingsScreen from '../../src/screens/AiSettingsScreen';
import { useAppPreferencesStore } from '../../src/stores/appPreferencesStore';

let mockAvailable = true;
jest.mock('../../src/services/onDeviceLabelScan', () => ({
  isOnDeviceLabelScanAvailable: () => mockAvailable,
}));
jest.mock('../../src/hooks/useActiveAiServiceSetting', () => ({
  useActiveAiServiceSetting: () => ({
    data: { service_name: 'OpenAI', model_name: 'gpt-x' },
    isLoading: false,
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../src/hooks/useScreenHeader', () => ({
  useScreenHeader: () => null,
}));
jest.mock('../../src/components/ActiveWorkoutBar', () => ({
  useActiveWorkoutBarPadding: () => 0,
}));
jest.mock('../../src/services/nativeTabBarPreference', () => ({
  useNativeIOSHeadersActive: () => false,
}));

const renderScreen = () =>
  render(
    <AiSettingsScreen
      navigation={{} as never}
      route={{ key: 'k', name: 'AiSettings' } as never}
    />
  );

describe('AiSettingsScreen', () => {
  beforeEach(() => {
    mockAvailable = true;
    useAppPreferencesStore.setState({ onDeviceLabelScanEnabled: false });
  });

  it('shows the active server provider', () => {
    const { getByTestId } = renderScreen();
    expect(getByTestId('ai-settings-provider').props.children).toBe(
      'OpenAI · gpt-x'
    );
  });

  it('turns on-device label scanning on and off', () => {
    const { getByTestId } = renderScreen();
    expect(getByTestId('ai-label-scan-switch').props.accessibilityLabel).toBe(
      'Scan Labels On Device'
    );
    fireEvent(getByTestId('ai-label-scan-switch'), 'valueChange', true);
    expect(useAppPreferencesStore.getState().onDeviceLabelScanEnabled).toBe(
      true
    );
    fireEvent(getByTestId('ai-label-scan-switch'), 'valueChange', false);
    expect(useAppPreferencesStore.getState().onDeviceLabelScanEnabled).toBe(
      false
    );
  });

  it('hides the toggle where Apple Intelligence is unavailable', () => {
    mockAvailable = false;
    const { queryByTestId, getByText } = renderScreen();
    expect(queryByTestId('ai-label-scan-switch')).toBeNull();
    expect(getByText(/Not available on this device/)).toBeTruthy();
  });
});
