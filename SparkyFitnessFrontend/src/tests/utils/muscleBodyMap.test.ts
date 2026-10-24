import {
  defaultBodyFigure,
  figureKeyForMuscle,
  heatLevel,
  setsForMuscleKey,
  unmappedMuscleSets,
} from '@workspace/shared';

describe('muscle heatmap matching', () => {
  it('matches HealthKit title case onto SVG schema names', () => {
    expect(setsForMuscleKey('biceps', { Biceps: 8, biceps: 2 })).toBe(10);
    expect(setsForMuscleKey('abdominals', { Abs: 4, Abdominals: 1 })).toBe(5);
    expect(setsForMuscleKey('quadriceps', { Quads: 3 })).toBe(3);
  });

  it('counts lats, including the latissimus dorsi alias', () => {
    expect(setsForMuscleKey('lats', { Lats: 6, 'Latissimus Dorsi': 1 })).toBe(
      7
    );
  });

  it('lists muscles the male SVG cannot tint', () => {
    expect(
      unmappedMuscleSets({ Biceps: 4, Lats: 6, Chest: 2, Neck: 3 })
    ).toEqual([{ muscle: 'Neck', sets: 3 }]);
  });

  it('resolves stored names and aliases to the region they tint', () => {
    expect(figureKeyForMuscle('Abs')).toBe('abdominals');
    expect(figureKeyForMuscle('Latissimus Dorsi')).toBe('lats');
    expect(figureKeyForMuscle('Lower Back')).toBe('lower back');
    expect(figureKeyForMuscle('Neck')).toBeNull();
  });

  it('starts on the female figure only for a stored female', () => {
    expect(defaultBodyFigure('female')).toBe('female');
    expect(defaultBodyFigure(' Female ')).toBe('female');
    expect(defaultBodyFigure('male')).toBe('male');
    expect(defaultBodyFigure(null)).toBe('male');
    expect(defaultBodyFigure(undefined)).toBe('male');
  });

  it('buckets set counts into four heat levels', () => {
    expect(heatLevel(0, 12)).toBe(0);
    expect(heatLevel(3, 12)).toBe(1);
    expect(heatLevel(6, 12)).toBe(2);
    expect(heatLevel(9, 12)).toBe(3);
    expect(heatLevel(12, 12)).toBe(4);
  });
});
