import { describe, expect, it } from 'vitest';
import {
  calculateRampedWeightKg,
  isWeightRampActive,
  isWeightRampSetType,
  weightRampStepIndexes,
} from '@workspace/shared';

const KG_PER_LB = 0.45359237;
const lbToKg = (lb: number) => lb * KG_PER_LB;
const kgToLb = (kg: number) => kg / KG_PER_LB;

describe('calculateRampedWeightKg', () => {
  it('returns the base unchanged at step 0', () => {
    expect(calculateRampedWeightKg(83.91, 0, 4.54, 'lbs')).toBe(83.91);
    expect(calculateRampedWeightKg(61.3, 0, 2.5, 'kg')).toBe(61.3);
  });

  it('ramps up in kg', () => {
    expect(
      [1, 2, 3].map((step) => calculateRampedWeightKg(60, step, 2.5, 'kg'))
    ).toEqual([62.5, 65, 67.5]);
  });

  it('ramps 185 lb by +10 lb to 195 / 205 lb despite the kg-stored increment', () => {
    // 10 lb stores as 4.54 kg in numeric(6,2); a 185 lb set stores as 83.91 kg.
    const results = [1, 2].map((step) =>
      kgToLb(calculateRampedWeightKg(83.91, step, 4.54, 'lbs'))
    );
    expect(results[0]).toBeCloseTo(195, 2);
    expect(results[1]).toBeCloseTo(205, 2);
  });

  it('ramps down with a negative increment', () => {
    expect(
      [1, 2].map((step) =>
        kgToLb(calculateRampedWeightKg(lbToKg(185), step, -4.54, 'lbs'))
      )
    ).toEqual([expect.closeTo(175, 2), expect.closeTo(165, 2)]);
    expect(calculateRampedWeightKg(100, 2, -5, 'kg')).toBe(90);
  });

  it('rounds awkward kg increments to a loadable 0.25 kg', () => {
    // 50 + 1.13 = 51.13 → 51.25; 50 + 2.26 = 52.26 → 52.25
    expect(calculateRampedWeightKg(50, 1, 1.13, 'kg')).toBe(51.25);
    expect(calculateRampedWeightKg(50, 2, 1.13, 'kg')).toBe(52.25);
  });

  it('rounds to 2.5 lb for pound users', () => {
    // 100 lb + 3 kg (6.61 lb) = 106.61 lb → 107.5 lb
    expect(
      kgToLb(calculateRampedWeightKg(lbToKg(100), 1, 3, 'lbs'))
    ).toBeCloseTo(107.5, 2);
  });

  it('floors a downward ramp at the smallest loadable step', () => {
    expect(calculateRampedWeightKg(20, 3, -10, 'kg')).toBe(0.25);
    expect(
      kgToLb(calculateRampedWeightKg(lbToKg(20), 3, -4.54, 'lbs'))
    ).toBeCloseTo(2.5, 2);
  });
});

describe('isWeightRampActive', () => {
  it('is off for null, zero, and non-finite values', () => {
    expect(isWeightRampActive(null)).toBe(false);
    expect(isWeightRampActive(undefined)).toBe(false);
    expect(isWeightRampActive(0)).toBe(false);
    expect(isWeightRampActive(Number.NaN)).toBe(false);
  });

  it('is on for positive and negative increments', () => {
    expect(isWeightRampActive(2.5)).toBe(true);
    expect(isWeightRampActive(-2.5)).toBe(true);
  });
});

describe('isWeightRampSetType / weightRampStepIndexes', () => {
  it('skips warm-up and drop sets in both vocabularies', () => {
    expect(isWeightRampSetType('warmup')).toBe(false);
    expect(isWeightRampSetType('Warm-up')).toBe(false);
    expect(isWeightRampSetType('drop')).toBe(false);
    expect(isWeightRampSetType('Drop Set')).toBe(false);
    expect(isWeightRampSetType('normal')).toBe(true);
    expect(isWeightRampSetType('Working Set')).toBe(true);
    expect(isWeightRampSetType('failure')).toBe(true);
    expect(isWeightRampSetType(null)).toBe(true);
  });

  it('numbers ramp-eligible sets from 0 and skips the rest', () => {
    expect(
      weightRampStepIndexes([
        { set_type: 'warmup' },
        { set_type: 'normal' },
        { set_type: 'failure' },
        { set_type: 'normal' },
        { set_type: 'drop' },
      ])
    ).toEqual([null, 0, 1, 2, null]);
  });
});
