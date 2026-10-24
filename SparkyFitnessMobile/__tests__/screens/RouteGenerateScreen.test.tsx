import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import type { GeneratedRoutePreview } from '@workspace/shared';
import RouteGenerateScreen from '../../src/screens/RouteGenerateScreen';
import {
  generateRoutePreview,
  saveGeneratedRoute,
  useRouteGenerationAvailable,
} from '../../src/services/routeService';
import { useScreenHeader } from '../../src/hooks/useScreenHeader';
import { ApiError } from '../../src/services/api/errors';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));
jest.mock('../../src/hooks/usePreferences', () => ({
  usePreferences: () => ({ preferences: { default_distance_unit: 'km' } }),
}));
jest.mock('../../src/hooks/useScreenHeader', () => ({
  useScreenHeader: jest.fn(() => null),
}));
jest.mock('../../src/services/routeService', () => ({
  generateRoutePreview: jest.fn(),
  saveGeneratedRoute: jest.fn(),
  useRouteGenerationAvailable: jest.fn(),
}));
jest.mock('../../src/services/LogService', () => ({ addLog: jest.fn() }));
jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

const mockAvailable = useRouteGenerationAvailable as jest.Mock;
const mockGenerate = generateRoutePreview as jest.Mock;
const mockSave = saveGeneratedRoute as jest.Mock;
const mockHeader = useScreenHeader as jest.Mock;
const mockPermission = Location.requestForegroundPermissionsAsync as jest.Mock;
const mockPosition = Location.getCurrentPositionAsync as jest.Mock;

const preview: GeneratedRoutePreview = {
  name: 'Generated 5.0 km run',
  activity: 'run',
  source: 'generated',
  points: [
    { lat: 40, lon: -100 },
    { lat: 40.01, lon: -100 },
    { lat: 40, lon: -100 },
  ],
  cues: [
    { index: 0, kind: 'depart' },
    { index: 1, kind: 'left', distanceM: 1000 },
    { index: 2, kind: 'arrive', distanceM: 5000 },
  ],
  distanceM: 5000,
  elevationGainM: 42,
};

const navigation = { replace: jest.fn(), goBack: jest.fn() };

function renderScreen() {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
        frame: { x: 0, y: 0, width: 390, height: 844 },
      }}
    >
      <RouteGenerateScreen
        navigation={navigation as never}
        route={{ key: 'k', name: 'RouteGenerate' } as never}
      />
    </SafeAreaProvider>
  );
}

const lastHeader = () => mockHeader.mock.calls.at(-1)?.[0];

describe('RouteGenerateScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAvailable.mockReturnValue({ available: true, isLoading: false });
    mockPermission.mockResolvedValue({ granted: true });
    mockPosition.mockResolvedValue({
      coords: { latitude: 40, longitude: -100 },
    });
  });

  it('explains when the server has no routing engine', () => {
    mockAvailable.mockReturnValue({ available: false, isLoading: false });
    const { getByText, queryByTestId } = renderScreen();
    expect(getByText(/needs a routing provider/i)).toBeTruthy();
    expect(queryByTestId('map-view')).toBeNull();
    expect(mockPermission).not.toHaveBeenCalled();
  });

  it('shows neither the map nor the notice while checking', () => {
    mockAvailable.mockReturnValue({ available: false, isLoading: true });
    const { queryByText, queryByTestId } = renderScreen();
    expect(queryByText(/needs a routing provider/i)).toBeNull();
    expect(queryByTestId('map-view')).toBeNull();
  });

  it('shows a spinner while generating, then the preview numbers', async () => {
    let resolve: (value: GeneratedRoutePreview) => void = () => undefined;
    mockGenerate.mockReturnValue(new Promise((r) => (resolve = r)));
    const { getByText, queryByText, getAllByTestId } = renderScreen();
    await waitFor(() => expect(mockPosition).toHaveBeenCalled());
    await waitFor(() =>
      expect(getByText(/Starting at the green pin/)).toBeTruthy()
    );

    fireEvent.press(getByText('Generate'));
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate.mock.calls[0][0]).toMatchObject({
      mode: 'loop',
      shape: 'loop',
      activity: 'run',
      distanceM: 5000,
      start: { lat: 40, lon: -100 },
    });
    expect(queryByText(/climb/)).toBeNull();

    await act(async () => resolve(preview));
    expect(getByText(/5\.00 km/)).toBeTruthy();
    expect(getByText(/42 m climb/)).toBeTruthy();
    expect(getByText(/1 turn\b/)).toBeTruthy();
    expect(getAllByTestId('map-polyline')).toHaveLength(1);
    expect(getByText('Try another direction')).toBeTruthy();
  });

  it('turns an engine error into a short message', async () => {
    mockGenerate.mockRejectedValue(new ApiError('Server error', 422, '{}'));
    const { getByText } = renderScreen();
    await waitFor(() =>
      expect(getByText(/Starting at the green pin/)).toBeTruthy()
    );
    fireEvent.press(getByText('Generate'));
    await waitFor(() => expect(getByText(/No route found there/)).toBeTruthy());
  });

  it('rate limit message is shown for a 429', async () => {
    mockGenerate.mockRejectedValue(new ApiError('Server error', 429, '{}'));
    const { getByText } = renderScreen();
    await waitFor(() =>
      expect(getByText(/Starting at the green pin/)).toBeTruthy()
    );
    fireEvent.press(getByText('Generate'));
    await waitFor(() =>
      expect(getByText(/Too many route requests/)).toBeTruthy()
    );
  });

  it('regenerates toward a different heading and keeps the preview if it fails', async () => {
    mockGenerate.mockResolvedValueOnce(preview);
    const { getByText, getAllByTestId } = renderScreen();
    await waitFor(() =>
      expect(getByText(/Starting at the green pin/)).toBeTruthy()
    );
    fireEvent.press(getByText('Generate'));
    await waitFor(() =>
      expect(getByText('Try another direction')).toBeTruthy()
    );
    const firstBearing = mockGenerate.mock.calls[0][0].bearingDeg;

    mockGenerate.mockRejectedValueOnce(new ApiError('Server error', 502, '{}'));
    fireEvent.press(getByText('Try another direction'));
    await waitFor(() =>
      expect(getByText(/routing service had a problem/)).toBeTruthy()
    );
    const secondBearing = mockGenerate.mock.calls[1][0].bearingDeg;
    const turn = (((secondBearing - firstBearing) % 360) + 360) % 360;
    expect(turn).toBeGreaterThanOrEqual(90);
    expect(turn).toBeLessThanOrEqual(270);
    expect(getAllByTestId('map-polyline')).toHaveLength(1);
    expect(getByText(/5\.00 km/)).toBeTruthy();
  });

  it('does not call the server for a distance it would reject', async () => {
    const { getByText, getByLabelText } = renderScreen();
    await waitFor(() =>
      expect(getByText(/Starting at the green pin/)).toBeTruthy()
    );
    fireEvent.changeText(getByLabelText('Distance'), '900');
    expect(getByText(/Choose between/)).toBeTruthy();
    fireEvent.press(getByText('Generate'));
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('saves the preview from the header and opens it', async () => {
    mockGenerate.mockResolvedValue(preview);
    mockSave.mockResolvedValue({ id: 'route-1' });
    const { getByText } = renderScreen();
    await waitFor(() =>
      expect(getByText(/Starting at the green pin/)).toBeTruthy()
    );
    expect(lastHeader().right.disabled).toBe(true);
    fireEvent.press(getByText('Generate'));
    await waitFor(() => expect(lastHeader().right.disabled).toBe(false));

    await act(async () => lastHeader().right.onPress());
    expect(mockSave).toHaveBeenCalledWith(preview, 'Generated 5.0 km run');
    expect(navigation.replace).toHaveBeenCalledWith('RouteDetail', {
      id: 'route-1',
    });
  });
});
