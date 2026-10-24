import { describe, expect, it } from 'vitest';
import { assertSetWeightSign } from '../utils/setWeightSign.js';

describe('assertSetWeightSign', () => {
  it('allows a negative weight only for a bodyweight exercise', () => {
    expect(() =>
      assertSetWeightSign([{ weight: -10 }], 'bodyweight_reps')
    ).not.toThrow();
    expect(() =>
      assertSetWeightSign([{ weight: 10 }], 'weight_reps')
    ).not.toThrow();
    expect(() => assertSetWeightSign([{ weight: -10 }], 'weight_reps')).toThrow(
      /Negative weight/
    );
    expect(() => assertSetWeightSign([{ weight: -10 }], null)).toThrow(
      /Negative weight/
    );
    expect(() =>
      assertSetWeightSign([{ weight: '-10' }], 'weight_reps')
    ).toThrow(/Negative weight/);
    expect(() =>
      assertSetWeightSign([{ weight: '-10' }], 'bodyweight_reps')
    ).not.toThrow();
    expect(() =>
      assertSetWeightSign([{ weight: 'not-a-number' }], 'weight_reps')
    ).not.toThrow();
  });
});
