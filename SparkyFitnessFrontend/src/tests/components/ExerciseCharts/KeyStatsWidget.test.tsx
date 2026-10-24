import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithClient } from '@/tests/test-utils';
import { KeyStatsWidget } from '@/components/ExerciseCharts/KeyStatsWidget';
import { ExerciseDashboardData } from '@/types/reports';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
  }),
  initReactI18next: {
    type: '3rdParty',
    init: jest.fn(),
  },
}));

const data: ExerciseDashboardData = {
  keyStats: {
    totalWorkouts: 12,
    totalVolume: 99700.4,
    totalReps: 1840,
  },
  prData: {},
  bestSetRepRange: {},
  muscleGroupVolume: {},
  muscleGroupSets: {},
  exerciseEntries: [],
  consistencyData: {
    currentStreak: 3,
    longestStreak: 8,
    weeklyFrequency: 2.4,
    monthlyFrequency: 10.1,
  },
  recoveryData: {},
  prProgressionData: {},
  exerciseVarietyData: {},
  setPerformanceData: {},
};

describe('KeyStatsWidget', () => {
  it('shows total volume once and rounds the displayed number', () => {
    renderWithClient(<KeyStatsWidget data={data} weightUnit="kg" />);

    expect(screen.getByText('Total Volume')).toBeInTheDocument();
    expect(screen.queryByText('Total Tonnage')).not.toBeInTheDocument();
    expect(screen.getByText('99700 kg')).toBeInTheDocument();
    expect(screen.queryByText(/99700\.4/)).not.toBeInTheDocument();
  });
});
