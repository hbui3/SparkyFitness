import { render, screen } from '@testing-library/react';
import TrainingCalendar from '@/pages/Exercises/TrainingCalendar';
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
      if (typeof fallback === 'string') return fallback;
      if (fallback && typeof fallback['defaultValue'] === 'string') {
        return fallback['defaultValue'];
      }
      return key;
    },
  }),
}));

describe('TrainingCalendar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-21T10:00:00.000Z'));
    jest.mocked(useTrainingTimeline).mockReturnValue({
      isLoading: false,
      data: {
        today: '2026-08-21',
        rangeStart: '2026-07-27',
        rangeEnd: '2026-09-06',
        activePlans: [],
        items: [
          {
            id: 'planned-1',
            date: '2026-08-21',
            name: 'Full Body A',
            source: 'Workout Plan',
            status: 'planned',
            workoutPresetId: 44,
            workoutPlanAssignmentId: 9,
            exerciseCount: 7,
            totalSetCount: 18,
            warmupSetCount: 2,
            workingSetCount: 16,
          },
        ],
        days: [
          {
            date: '2026-08-21',
            status: 'in_progress',
            scheduledWorkoutCount: 1,
            completedScheduledWorkoutCount: 0,
            completedWorkoutCount: 0,
            scheduledExerciseCount: 7,
            completedScheduledExerciseCount: 2,
            scheduledSetCount: 18,
            completedScheduledSetCount: 5,
            scheduledWarmupSetCount: 2,
            completedScheduledWarmupSetCount: 2,
            scheduledNames: ['Full Body A'],
            completedNames: [],
            sources: [],
          },
        ],
      },
    } as ReturnType<typeof useTrainingTimeline>);
  });

  afterEach(() => jest.useRealTimers());

  it('shows a navigable month and the exact selected-day progress', () => {
    render(<TrainingCalendar />);

    expect(screen.getByText('Training calendar')).toBeTruthy();
    expect(screen.getAllByText('Full Body A').length).toBeGreaterThan(0);
    expect(screen.getByText(/5 \/ 18/)).toBeTruthy();
    expect(useTrainingTimeline).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        startDate: '2026-07-27',
        endDate: '2026-09-06',
      })
    );
  });
});
