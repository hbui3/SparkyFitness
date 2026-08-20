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
    data: '<svg><path class="chest"></path><path class="quads"></path></svg>',
  }),
}));

describe('MuscleBodyMap load colors', () => {
  it('renders muscles without recent load as ready', () => {
    const { container, queryByText } = render(
      <MuscleBodyMap variant="load" muscleLoad={[]} />
    );

    expect(container.querySelector('path.chest')).toHaveClass('map-ready');
    expect(container.querySelector('path.quads')).toHaveClass('map-ready');
    expect(queryByText('No recent data')).not.toBeInTheDocument();
  });
});
