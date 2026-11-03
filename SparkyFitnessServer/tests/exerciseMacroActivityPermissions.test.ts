import { beforeEach, expect, it, vi } from 'vitest';
import { getAdaptiveActivityCalories } from '../services/adaptiveActivityService.js';
import workoutDeduplicationService from '../services/workoutDeduplicationService.js';
import measurementRepository from '../models/measurementRepository.js';

vi.mock('../services/workoutDeduplicationService.js', () => ({
  default: { getCanonicalExerciseCalorieSplits: vi.fn() },
}));
vi.mock('../models/measurementRepository.js');

beforeEach(() => vi.clearAllMocks());

it('omits check-in queries and steps when the caller lacks check-in access', async () => {
  vi.mocked(
    workoutDeduplicationService.getCanonicalExerciseCalorieSplits
  ).mockResolvedValue([
    {
      entry_date: '2026-10-20',
      other_calories: 500,
      active_calories: 0,
      activity_steps: 0,
    },
  ]);
  const result = await getAdaptiveActivityCalories(
    'user-1',
    '2026-10-20',
    '2026-10-20',
    [{ entry_date: '2026-10-20', steps: 20000, weight: 80, height: 180 }],
    false
  );
  expect(result.get('2026-10-20')).toBe(500);
  expect(
    workoutDeduplicationService.getCanonicalExerciseCalorieSplits
  ).toHaveBeenCalledWith('user-1', '2026-10-20', '2026-10-20');
  expect(
    measurementRepository.getLatestCheckInMeasurementsOnOrBeforeDate
  ).not.toHaveBeenCalled();
  expect(measurementRepository.getLatestWeightHeight).not.toHaveBeenCalled();
});
