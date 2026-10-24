import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import SymptomsCard from '../../src/components/SymptomsCard';
import {
  useOngoingEpisodes,
  useSymptomEntriesDetailed,
  useSymptomFreeDays,
  useSymptomActions,
} from '../../src/hooks/useSymptoms';

jest.mock('../../src/hooks/useSymptoms', () => ({
  useOngoingEpisodes: jest.fn(),
  useSymptomEntriesDetailed: jest.fn(),
  useSymptomFreeDays: jest.fn(),
  useSymptomActions: jest.fn(),
}));

jest.mock('../../src/components/Icon', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ name }: { name: string }) => <View testID={`icon-${name}`} />,
  };
});

jest.mock('uniwind', () => ({
  useCSSVariable: (keys: string | string[]) =>
    Array.isArray(keys) ? keys.map(() => '#111827') : '#111827',
}));

const mockUseOngoingEpisodes = useOngoingEpisodes as jest.MockedFunction<
  typeof useOngoingEpisodes
>;
const mockUseSymptomEntriesDetailed =
  useSymptomEntriesDetailed as jest.MockedFunction<
    typeof useSymptomEntriesDetailed
  >;
const mockUseSymptomFreeDays = useSymptomFreeDays as jest.MockedFunction<
  typeof useSymptomFreeDays
>;
const mockUseSymptomActions = useSymptomActions as jest.MockedFunction<
  typeof useSymptomActions
>;

const mockMarkFree = { mutate: jest.fn() };
const mockUnmarkFree = { mutate: jest.fn() };

const mockNavigate = jest.fn();
const mockNavigation = {
  navigate: mockNavigate,
} as unknown as React.ComponentProps<typeof SymptomsCard>['navigation'];

describe('SymptomsCard on Dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseOngoingEpisodes.mockReturnValue({
      episodes: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useOngoingEpisodes>);
    mockUseSymptomEntriesDetailed.mockReturnValue({
      entries: [],
      isLoading: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useSymptomEntriesDetailed>);
    mockUseSymptomFreeDays.mockReturnValue({
      freeDays: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useSymptomFreeDays>);
    mockUseSymptomActions.mockReturnValue({
      markFree: mockMarkFree,
      unmarkFree: mockUnmarkFree,
    } as unknown as ReturnType<typeof useSymptomActions>);
  });

  it('renders title and navigates to SymptomHistory on header press', () => {
    const { getByText } = render(
      <SymptomsCard navigation={mockNavigation} date="2026-10-02" />
    );

    expect(getByText('Symptoms')).toBeTruthy();
    expect(getByText('History')).toBeTruthy();

    fireEvent.press(getByText('History'));
    expect(mockNavigate).toHaveBeenCalledWith('SymptomHistory');
  });

  it('renders prompt and quick action buttons when no symptoms recorded', () => {
    const { getByText } = render(
      <SymptomsCard navigation={mockNavigation} date="2026-10-02" />
    );

    expect(getByText('No symptoms recorded today')).toBeTruthy();
    expect(getByText('+ Log')).toBeTruthy();
    expect(getByText('Mark Free')).toBeTruthy();

    fireEvent.press(getByText('+ Log'));
    expect(mockNavigate).toHaveBeenCalledWith('SymptomLog', {
      date: '2026-10-02',
    });

    fireEvent.press(getByText('Mark Free'));
    expect(mockMarkFree.mutate).toHaveBeenCalledWith('2026-10-02');
  });

  it('renders marked symptom-free badge and allows undoing', () => {
    mockUseSymptomFreeDays.mockReturnValue({
      freeDays: [{ id: 'f-1', entry_date: '2026-10-02', created_at: '' }],
      isLoading: false,
    } as unknown as ReturnType<typeof useSymptomFreeDays>);

    const { getByText } = render(
      <SymptomsCard navigation={mockNavigation} date="2026-10-02" />
    );

    expect(getByText('Marked symptom-free today')).toBeTruthy();
    expect(getByText('Undo')).toBeTruthy();

    fireEvent.press(getByText('Undo'));
    expect(mockUnmarkFree.mutate).toHaveBeenCalledWith('2026-10-02');
  });

  it('renders active ongoing episode alert when one exists', () => {
    mockUseOngoingEpisodes.mockReturnValue({
      episodes: [
        {
          id: 'ep-1',
          symptom_name_snapshot: 'Migraine',
          started_at: '2026-10-02T10:00:00Z',
          ended_at: null,
          severity: 7,
          entry_date: '2026-10-02',
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useOngoingEpisodes>);

    const { getByText } = render(
      <SymptomsCard navigation={mockNavigation} date="2026-10-02" />
    );

    expect(getByText('Active Episode')).toBeTruthy();
    expect(getByText(/Migraine/)).toBeTruthy();

    fireEvent.press(getByText('Active Episode'));
    expect(mockNavigate).toHaveBeenCalledWith('SymptomLog', {
      entryId: 'ep-1',
      date: '2026-10-02',
      isOngoing: true,
    });
  });

  it('renders logged symptoms with severity and triggers', () => {
    mockUseSymptomEntriesDetailed.mockReturnValue({
      entries: [
        {
          id: 'e-1',
          symptom_name_snapshot: 'Tension Headache',
          severity: 4,
          triggers: ['Poor sleep'],
          entry_date: '2026-10-02',
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useSymptomEntriesDetailed>);

    const { getByText } = render(
      <SymptomsCard navigation={mockNavigation} date="2026-10-02" />
    );

    expect(getByText('Tension Headache')).toBeTruthy();
    expect(getByText('4/10')).toBeTruthy();
    expect(getByText('Poor sleep')).toBeTruthy();
  });
});
