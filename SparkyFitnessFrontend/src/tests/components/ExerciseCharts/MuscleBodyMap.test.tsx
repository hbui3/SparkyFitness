import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import MuscleBodyMap from '@/components/ExerciseCharts/MuscleBodyMap';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue?: string) => defaultValue,
  }),
}));

jest.mock('@/hooks/Exercises/useExercises', () => ({
  useBodyMapSvgQuery: () => ({
    data: '<svg><path class="chest"></path><path class="quads"></path><path class="lats"></path><path class="traps"></path></svg>',
  }),
}));

describe('MuscleBodyMap load colors', () => {
  it('renders muscles without recorded load as unassessed', () => {
    const { container, queryByText } = render(
      <MuscleBodyMap variant="load" muscleLoad={[]} />
    );

    expect(container.querySelector('path.chest')).toHaveClass('map-inactive');
    expect(container.querySelector('path.quads')).toHaveClass('map-inactive');
    expect(queryByText('No recorded load')).toBeInTheDocument();
  });

  it('shows lat load on its own paths without marking the traps as loaded', () => {
    const { container } = render(
      <MuscleBodyMap
        variant="load"
        muscleLoad={[
          {
            muscle: 'lats',
            status: 'high',
            loadScore: 90,
            lastTrainedOn: '2026-11-03',
            recentVolumeKg: 1000,
            recentSets: 5,
            sources: ['Speediance'],
          },
        ]}
      />
    );

    expect(container.querySelector('path.lats')).toHaveClass('map-high');
    expect(container.querySelector('path.traps')).toHaveClass('map-inactive');
  });
});
