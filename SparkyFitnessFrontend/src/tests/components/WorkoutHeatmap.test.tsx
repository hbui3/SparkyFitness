import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorkoutHeatmap from '@/pages/Reports/WorkoutHeatmap';
import { workoutHeatmapWindow } from '@/utils/workoutHeatmap';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : (fallback?.defaultValue ?? key),
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ firstDayOfWeek: 1 }),
}));

describe('workoutHeatmapWindow (#2461)', () => {
  it('covers the first of the month eleven months back through today', () => {
    expect(workoutHeatmapWindow('2026-09-24')).toEqual({
      start: '2025-10-01',
      end: '2026-09-24',
    });
    expect(workoutHeatmapWindow('2026-01-15')).toEqual({
      start: '2025-02-01',
      end: '2026-01-15',
    });
  });
});

describe('WorkoutHeatmap', () => {
  it('shows 12 months and outlines only days inside the filtered range', () => {
    render(
      <WorkoutHeatmap
        today="2026-09-24"
        workoutDays={[
          { date: '2025-10-03', count: 1 },
          { date: '2026-09-10', count: 3 },
        ]}
        rangeStart="2026-09-10"
        rangeEnd="2026-09-24"
      />
    );

    // A workout outside the filter (11 months ago) is still shown.
    const october = screen.getByTestId('heatmap-day-2025-10-03');
    expect(october).toHaveClass('bg-green-500');
    expect(october).not.toHaveAttribute('data-in-range');

    const inRange = screen.getByTestId('heatmap-day-2026-09-10');
    expect(inRange).toHaveClass('bg-green-700');
    expect(inRange).toHaveAttribute('data-in-range', 'true');

    expect(screen.getByTestId('heatmap-day-2026-09-09')).not.toHaveAttribute(
      'data-in-range'
    );
    expect(screen.queryByTestId('heatmap-day-2025-09-30')).toBeNull();
  });

  it('pages one month at a time below the desktop grid, starting on the selected range', () => {
    render(
      <WorkoutHeatmap
        today="2026-09-24"
        workoutDays={[{ date: '2026-08-02', count: 1 }]}
        rangeStart="2026-08-01"
        rangeEnd="2026-08-31"
      />
    );

    expect(screen.getByTestId('heatmap-mobile-month')).toHaveTextContent(
      'Aug 2026'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('heatmap-mobile-month')).toHaveTextContent(
      'Sep 2026'
    );
  });
});
