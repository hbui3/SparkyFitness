import { render, screen } from '@testing-library/react';
import TrainingTimeline from '@/pages/Exercises/TrainingTimeline';
import { useTrainingTimeline } from '@/hooks/Exercises/useWorkoutPlans';

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('@/hooks/Exercises/useWorkoutPlans', () => ({
  useTrainingTimeline: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en', resolvedLanguage: 'en' },
    t: (key: string, fallback?: string | Record<string, string | number>) => {
      if (key === 'trainingTimeline.exactCounts' && fallback) {
        const values = fallback as Record<string, string | number>;
        return `${values['exercises']} exercises · ${values['sets']} sets · ${values['warmups']} warm-up sets`;
      }
      if (typeof fallback === 'string') return fallback;
      if (fallback && typeof fallback['defaultValue'] === 'string') {
        return fallback['defaultValue'];
      }
      return key;
    },
  }),
}));

describe('TrainingTimeline', () => {
  it('shows the active plan, exact zero warm-up count, history, and future sessions', () => {
    jest.mocked(useTrainingTimeline).mockReturnValue({
      isLoading: false,
      data: {
        today: '2026-08-21',
        rangeStart: '2026-07-22',
        rangeEnd: '2026-12-19',
        activePlans: [
          {
            id: 1,
            name: 'Sparky Muskelaufbau',
            description: 'Three sessions per week',
            startDate: '2026-08-24',
            endDate: '2026-10-18',
            assignments: [
              {
                dayOfWeek: 1,
                presetId: 44,
                workoutName: 'Full Body A',
                exerciseCount: 7,
                totalSetCount: 18,
                warmupSetCount: 0,
                workingSetCount: 18,
              },
            ],
          },
        ],
        items: [
          {
            id: 'completed-1',
            date: '2026-08-20',
            name: 'Full Body A',
            source: 'Speediance',
            status: 'completed',
            workoutPresetId: 44,
            workoutPlanAssignmentId: null,
            exerciseCount: 7,
            totalSetCount: 18,
            warmupSetCount: 0,
            workingSetCount: 18,
          },
          {
            id: 'planned-1',
            date: '2026-08-24',
            name: 'Full Body A',
            source: 'Workout Plan',
            status: 'planned',
            workoutPresetId: 44,
            workoutPlanAssignmentId: 9,
            exerciseCount: 7,
            totalSetCount: 18,
            warmupSetCount: 0,
            workingSetCount: 18,
          },
        ],
        days: [],
      },
    } as ReturnType<typeof useTrainingTimeline>);

    render(<TrainingTimeline />);

    expect(screen.getByText('Sparky Muskelaufbau')).toBeTruthy();
    expect(
      screen.getAllByText(/7 exercises · 18 sets · 0 warm-up sets/)
    ).toHaveLength(3);
    expect(screen.getByText(/Speediance/)).toBeTruthy();
    expect(screen.getByText(/Workout Plan/)).toBeTruthy();
    expect(screen.getAllByText('No warm-up sets configured')).toHaveLength(2);
  });
});
