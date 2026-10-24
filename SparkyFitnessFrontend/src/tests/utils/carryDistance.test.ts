import {
  carryDistanceFromKm,
  carryDistanceToKm,
  carryDistanceUnitLabel,
} from '@workspace/shared';
import { SET_TABLE_LAYOUT, defaultSetForModality } from '@/constants/exercises';

describe('carry distance', () => {
  it('shows metres for km and yards for miles', () => {
    expect(carryDistanceFromKm(0.03, 'km')).toBeCloseTo(30, 6);
    expect(carryDistanceFromKm(0.03, 'miles')).toBeCloseTo(32.8, 1);
    expect(carryDistanceUnitLabel('km')).toBe('m');
    expect(carryDistanceUnitLabel('miles')).toBe('yd');
  });

  it('round-trips back to km', () => {
    expect(
      carryDistanceToKm(carryDistanceFromKm(0.05, 'miles'), 'miles')
    ).toBeCloseTo(0.05, 9);
  });
});

describe('weighted set layouts', () => {
  it('carries show weight and distance but not reps', () => {
    expect(SET_TABLE_LAYOUT.weight_distance).toMatchObject({
      showReps: false,
      showWeight: true,
      showDistance: true,
    });
  });

  it('loaded holds show weight and no reps or distance', () => {
    expect(SET_TABLE_LAYOUT.weight_duration).toMatchObject({
      showReps: false,
      showWeight: true,
      showDistance: false,
    });
  });

  it('seeds timed/carry sets without a placeholder rep count', () => {
    expect(defaultSetForModality('weight_distance').reps).toBeNull();
    expect(defaultSetForModality('weight_duration').reps).toBeNull();
    expect(defaultSetForModality('weight_reps').reps).toBe(10);
  });
});
