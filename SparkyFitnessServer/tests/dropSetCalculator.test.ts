import { describe, expect, it } from 'vitest';
import {
  calculateDropSetWeights,
  calculateDropSetWeightsKg,
  findDropSetBaseIndex,
  isWarmupOrDropSetType,
} from '@workspace/shared';

describe('calculateDropSetWeights', () => {
  it('calculates 3 drop sets at 20% reduction rounded to 0.25', () => {
    // 100 -> 80 -> 64 -> 51.25
    const results = calculateDropSetWeights({
      baseWeight: 100,
      count: 3,
      dropPercent: 20,
      roundIncrement: 0.25,
    });
    expect(results).toEqual([80, 64, 51.25]);
  });

  it('handles custom counts and increments', () => {
    // 50 -> 40 -> 32
    const results = calculateDropSetWeights({
      baseWeight: 50,
      count: 2,
      dropPercent: 20,
      roundIncrement: 0.5,
    });
    expect(results).toEqual([40, 32]);
  });

  it('handles invalid inputs gracefully', () => {
    expect(calculateDropSetWeights({ baseWeight: 0 })).toEqual([]);
    expect(calculateDropSetWeights({ baseWeight: -10 })).toEqual([]);
  });
});

describe('calculateDropSetWeightsKg', () => {
  it('rounds to 0.25 kg for kg users', () => {
    expect(calculateDropSetWeightsKg(100, 'kg')).toEqual([80, 64, 51.25]);
  });

  it('rounds to loadable 2.5 lb steps for lb users, returned in kg', () => {
    // 225 lb → 180 / 145 / 115 lb (not the kg-rounded 180.04 / 144.07 lb).
    const lbs = calculateDropSetWeightsKg(225 * 0.45359237, 'lbs').map(
      (kg) => Math.round((kg / 0.45359237) * 100) / 100
    );
    expect(lbs).toEqual([180, 145, 115]);
  });
});

describe('findDropSetBaseIndex', () => {
  it('drops from the last working set with a weight, skipping warm-ups and drop sets', () => {
    const sets = [
      { set_type: 'warmup', weight: 40 },
      { set_type: 'normal', weight: 100 },
      { set_type: 'normal', weight: null },
      { set_type: 'drop', weight: 80 },
    ];
    expect(findDropSetBaseIndex(sets)).toBe(1);
  });

  it('uses a placeholder weight for untyped sets when given one', () => {
    const sets = [{ set_type: 'Working Set', weight: null }];
    expect(findDropSetBaseIndex(sets, () => 90)).toBe(0);
  });

  it('returns -1 when no working set has a weight', () => {
    expect(findDropSetBaseIndex([{ set_type: 'Warm-up', weight: 40 }])).toBe(
      -1
    );
  });
});

describe('isWarmupOrDropSetType', () => {
  it('matches both web and mobile set-type spellings', () => {
    for (const type of ['warmup', 'Warm-up', 'drop', 'Drop Set', 'dropset']) {
      expect(isWarmupOrDropSetType(type)).toBe(true);
    }
    for (const type of ['normal', 'Working Set', 'failure', null]) {
      expect(isWarmupOrDropSetType(type)).toBe(false);
    }
  });
});
