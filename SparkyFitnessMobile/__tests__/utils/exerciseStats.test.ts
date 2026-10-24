import { svgClassToSchemaName } from '@workspace/shared';
import {
  muscleRecoveryRows,
  muscleSetRows,
  rankedMuscleValues,
} from '../../src/utils/exerciseStats';
import { MUSCLE_FIGURES } from '../../src/components/exerciseStats/muscleFigurePaths';

describe('muscleSetRows', () => {
  it('combines names that tint the same figure region, largest first', () => {
    expect(
      muscleSetRows({ Abs: 3, Abdominals: 4, Chest: 9, Neck: 2, Biceps: 0 })
    ).toEqual([
      { key: 'chest', name: 'chest', sets: 9, onFigure: true },
      { key: 'abdominals', name: 'abdominals', sets: 7, onFigure: true },
      { key: 'neck', name: 'Neck', sets: 2, onFigure: false },
    ]);
  });

  it('returns nothing for an empty range', () => {
    expect(muscleSetRows({})).toEqual([]);
  });
});

describe('muscleRecoveryRows', () => {
  it('orders by most recently trained and counts calendar days', () => {
    expect(
      muscleRecoveryRows(
        { Chest: '2026-09-20', Quadriceps: '2026-09-27', Lats: '2026-09-26' },
        '2026-09-27'
      )
    ).toEqual([
      { name: 'Quadriceps', lastDate: '2026-09-27', daysAgo: 0 },
      { name: 'Lats', lastDate: '2026-09-26', daysAgo: 1 },
      { name: 'Chest', lastDate: '2026-09-20', daysAgo: 7 },
    ]);
  });

  it('keeps an unparseable date without a day count', () => {
    expect(muscleRecoveryRows({ Chest: 'soon' }, '2026-09-27')).toEqual([
      { name: 'Chest', lastDate: 'soon', daysAgo: null },
    ]);
  });
});

describe('rankedMuscleValues', () => {
  it('drops zeros and sorts largest first', () => {
    expect(rankedMuscleValues({ Chest: 2, Lats: 5, Calves: 0 })).toEqual([
      { name: 'Lats', value: 5 },
      { name: 'Chest', value: 2 },
    ]);
  });
});

describe.each(['male', 'female'] as const)('%s figure paths', (figure) => {
  const { paths, viewBox } = MUSCLE_FIGURES[figure];

  it('draws every region class the shared map knows, and no others', () => {
    const classes = new Set(
      paths
        .map((path) => path.svgClass)
        .filter((svgClass): svgClass is string => svgClass !== null)
    );
    expect([...classes].sort()).toEqual(
      Object.keys(svgClassToSchemaName).sort()
    );
  });

  it('draws untinted parts besides the regions', () => {
    expect(paths.some((path) => path.svgClass === null)).toBe(true);
  });

  it('matches the male figure height so strokes scale alike', () => {
    expect(viewBox.split(' ')[3]).toBe('462');
  });
});
