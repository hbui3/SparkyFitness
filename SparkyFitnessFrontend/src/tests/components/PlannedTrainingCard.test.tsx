import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
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
  it('does not claim that the day is empty when its request failed', () => {
    const refetch = jest.fn();
    jest.mocked(useTrainingTimeline).mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      refetch,
    } as unknown as ReturnType<typeof useTrainingTimeline>);
    render(
      <MemoryRouter>
        <PlannedTrainingCard selectedDate="2026-08-21" />
      </MemoryRouter>
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Failed to load the training timeline.'
    );
    expect(
      screen.queryByText('No workout is planned for this day.')
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
