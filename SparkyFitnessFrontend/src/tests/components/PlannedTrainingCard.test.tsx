import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PlannedTrainingCard from '@/pages/Diary/PlannedTrainingCard';
import { useTrainingTimeline } from '@/hooks/Exercises/useWorkoutPlans';

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('@/hooks/Exercises/useWorkoutPlans', () => ({
  useTrainingTimeline: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, string | number>) => {
      if (typeof fallback === 'string') return fallback;
      if (fallback && typeof fallback['defaultValue'] === 'string') {
        return fallback['defaultValue'];
      }
      return key;
    },
  }),
}));

describe('PlannedTrainingCard', () => {
  it('shows the selected diary day as completed versus scheduled targets', () => {
    jest.mocked(useTrainingTimeline).mockReturnValue({
      isLoading: false,
      data: {
        today: '2026-08-21',
        rangeStart: '2026-08-21',
        rangeEnd: '2026-08-21',
        activePlans: [],
        items: [],
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
    } as unknown as ReturnType<typeof useTrainingTimeline>);

    render(
      <MemoryRouter>
        <PlannedTrainingCard selectedDate="2026-08-21" />
      </MemoryRouter>
    );

    expect(screen.getByText('Full Body A')).toBeTruthy();
    expect(screen.getByText('2 / 7')).toBeTruthy();
    expect(screen.getByText('5 / 18')).toBeTruthy();
    expect(screen.getByText('28%')).toBeTruthy();
  });
});
