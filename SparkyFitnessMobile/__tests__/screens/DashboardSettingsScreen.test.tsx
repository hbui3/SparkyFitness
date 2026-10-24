import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import DashboardSettingsScreen from '../../src/screens/DashboardSettingsScreen';
import { initializeI18n } from '../../src/localization/i18n';
import {
  useAppPreferencesStore,
  __resetAppPreferencesStoreForTests,
} from '../../src/stores/appPreferencesStore';
import { DASHBOARD_CARD_KEYS } from '../../src/constants/dashboardCards';

jest.mock('../../src/hooks', () => ({
  useServerConnection: jest.fn(() => ({
    isConnected: false,
    isLoading: false,
  })),
  useCustomNutrients: jest.fn(() => ({
    customNutrients: [],
    isLoading: false,
  })),
  useNutrientDisplayPreferences: jest.fn(() => ({
    preferences: [],
    isLoading: false,
  })),
}));

jest.mock('../../src/hooks/useScreenHeader', () => ({
  useScreenHeader: () => null,
}));

jest.mock('../../src/services/nativeTabBarPreference', () => ({
  useNativeIOSHeadersActive: () => false,
}));

jest.mock('../../src/components/ActiveWorkoutBar', () => ({
  useActiveWorkoutBarPadding: () => 0,
}));

jest.mock('../../src/components/Icon', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ name }: { name: string }) => <View testID={`icon-${name}`} />,
  };
});

const insets = { top: 0, bottom: 0, left: 0, right: 0 };
const frame = { x: 0, y: 0, width: 390, height: 844 };

const navigation = { navigate: jest.fn(), goBack: jest.fn() };

const renderScreen = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider initialMetrics={{ frame, insets }}>
        <DashboardSettingsScreen
          {...({ navigation, route: { params: {} } } as never)}
        />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
};

const orderedRowKeys = (): string[] =>
  screen
    .queryAllByTestId(/^dashboard-card-row-/)
    .map((row) => String(row.props.testID).replace('dashboard-card-row-', ''));

describe('DashboardSettingsScreen', () => {
  beforeAll(async () => {
    await initializeI18n('en');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    __resetAppPreferencesStoreForTests();
  });

  const moveRow = (cardKey: string, actionName: 'increment' | 'decrement') =>
    fireEvent(
      screen.getByTestId(`dashboard-card-drag-handle-${cardKey}`),
      'accessibilityAction',
      { nativeEvent: { actionName } }
    );

  test('renders every dashboard card in the order from the store', () => {
    renderScreen();

    expect(orderedRowKeys()).toEqual([...DASHBOARD_CARD_KEYS]);
  });

  test('the Health Trends configure button navigates to HealthTrendsSettings', () => {
    renderScreen();

    const configureBtn = screen.getByTestId(
      'dashboard-card-configure-healthTrends'
    );
    expect(configureBtn).toBeTruthy();

    fireEvent.press(configureBtn);
    expect(navigation.navigate).toHaveBeenCalledWith('HealthTrendsSettings');
  });

  test('toggling a card switch updates its visibility in appPreferencesStore', () => {
    renderScreen();

    const hydrationSwitch = screen.getByTestId(
      'dashboard-card-switch-hydration'
    );
    expect(hydrationSwitch.props.value).toBe(true);

    fireEvent(hydrationSwitch, 'valueChange', false);
    expect(useAppPreferencesStore.getState().hydrationCardVisible).toBe(false);

    fireEvent(hydrationSwitch, 'valueChange', true);
    expect(useAppPreferencesStore.getState().hydrationCardVisible).toBe(true);
  });

  test('reordering cards updates dashboardCardOrder in the store', () => {
    renderScreen();

    moveRow('calorieRing', 'increment');

    const state = useAppPreferencesStore.getState();
    expect(state.dashboardCardOrder[0]).toBe('askSparky');
    expect(state.dashboardCardOrder[1]).toBe('calorieRing');
  });
});
