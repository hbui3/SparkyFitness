import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorkoutSyncResult from '@/components/WorkoutSyncResult';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values: Record<string, unknown> = {}) =>
      fallback.replace(/{{(\w+)}}/g, (_match, name: string) =>
        String(values[name] ?? '')
      ),
  }),
}));

it('shows partial failures and retries the displayed period on request', () => {
  const retry = jest.fn();
  render(
    <WorkoutSyncResult
      result={{
        success: false,
        createdActivities: 18,
        updatedActivities: 2,
        failedActivities: 3,
        startDate: '2026-10-01',
        endDate: '2026-10-24',
      }}
      onRetry={retry}
      isPending={false}
    />
  );
  expect(
    screen.getByText('18 imported, 2 updated, 3 failed.')
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry this period' }));
  expect(retry).toHaveBeenCalledTimes(1);
});

it('shows a completed Speediance result without offering a redundant retry', () => {
  render(
    <WorkoutSyncResult
      result={{
        success: true,
        importedWorkouts: 4,
        importedExercises: 16,
        skippedWorkouts: 0,
        startDate: '2026-10-01',
        endDate: '2026-10-24',
      }}
      onRetry={jest.fn()}
      isPending={false}
    />
  );
  expect(
    screen.getByText('4 imported, 0 updated, 0 failed.')
  ).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
