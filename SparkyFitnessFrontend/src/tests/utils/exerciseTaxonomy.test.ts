import i18n from '@/i18n';
import { localizeMuscle, localizeEquipment } from '@/utils/exerciseTaxonomy';
import {
  isCanonicalMuscle,
  isCanonicalEquipment,
  resolveCanonicalOrCustomMuscle,
  resolveCanonicalOrCustomEquipment,
  formatTaxonomyFallback,
} from '@workspace/shared';

describe('exerciseTaxonomy', () => {
  it('identifies canonical muscles and equipment correctly', () => {
    expect(isCanonicalMuscle('quadriceps')).toBe(true);
    expect(isCanonicalMuscle('lower back')).toBe(true);
    expect(isCanonicalMuscle('Upper Chest Area')).toBe(false);

    expect(isCanonicalEquipment('barbell')).toBe(true);
    expect(isCanonicalEquipment('e-z curl bar')).toBe(true);
    expect(isCanonicalEquipment('fancy machine')).toBe(false);
  });

  it('formats taxonomy fallback labels with title case', () => {
    expect(formatTaxonomyFallback('lower back')).toBe('Lower Back');
    expect(formatTaxonomyFallback('e-z curl bar')).toBe('E-Z Curl Bar');
    expect(formatTaxonomyFallback('quadriceps')).toBe('Quadriceps');
    expect(formatTaxonomyFallback('custom muscle')).toBe('Custom Muscle');
  });

  it('resolves canonical matches to lowercase canonical name and preserves custom names', () => {
    expect(resolveCanonicalOrCustomMuscle('Quads')).toBe('quadriceps');
    expect(resolveCanonicalOrCustomMuscle('quadriceps')).toBe('quadriceps');
    expect(resolveCanonicalOrCustomMuscle('Pecs')).toBe('chest');
    expect(resolveCanonicalOrCustomMuscle('Upper Chest')).toBe('Upper Chest');

    expect(resolveCanonicalOrCustomEquipment('Dumbbells')).toBe('dumbbell');
    expect(resolveCanonicalOrCustomEquipment('Barbell')).toBe('barbell');
    expect(resolveCanonicalOrCustomEquipment('Custom Machine')).toBe(
      'Custom Machine'
    );
  });

  it('localizes canonical muscles and equipment in English via i18n', () => {
    const t = i18n.t.bind(i18n);
    expect(localizeMuscle(t, 'quadriceps')).toBe('Quadriceps');
    expect(localizeMuscle(t, 'lower back')).toBe('Lower Back');
    expect(localizeMuscle(t, 'abdominals')).toBe('Abdominals');

    expect(localizeEquipment(t, 'barbell')).toBe('Barbell');
    expect(localizeEquipment(t, 'e-z curl bar')).toBe('E-Z Curl Bar');
    expect(localizeEquipment(t, 'body only')).toBe('Body Only');
  });

  it('falls back gracefully for unknown muscles and equipment', () => {
    const t = i18n.t.bind(i18n);
    expect(localizeMuscle(t, 'upper chest area')).toBe('Upper Chest Area');
    expect(localizeEquipment(t, 'smith rack')).toBe('Smith Rack');
    expect(localizeMuscle(t, null)).toBe('');
    expect(localizeEquipment(t, undefined)).toBe('');
  });
});
