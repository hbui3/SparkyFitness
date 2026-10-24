import { vi, beforeEach, describe, expect, it } from 'vitest';
import goalService from '../services/goalService.js';
import goalRepository from '../models/goalRepository.js';
import customNutrientService from '../services/customNutrientService.js';

vi.mock('../models/goalRepository');
vi.mock('../utils/timezoneLoader');
vi.mock('../services/customNutrientService');

const userId = 'user-123';
const testDate = '2026-06-22';

describe('manageGoalTimeline optional caffeine/alcohol limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(customNutrientService.getCustomNutrients).mockResolvedValue([]);
  });

  const saved = async (field: 'caffeine_mg' | 'alcohol_g', value: unknown) => {
    await goalService.manageGoalTimeline(userId, {
      p_start_date: testDate,
      p_cascade: false,
      p_calories: 2000,
      [`p_${field}`]: value,
    });
    return vi.mocked(goalRepository.upsertGoal).mock.calls[0][0][field];
  };

  describe.each(['caffeine_mg', 'alcohol_g'] as const)('%s', (field) => {
    it.each([undefined, null, '', '   '])(
      'stores a missing limit (%j) as null, not 0',
      async (value) => {
        expect(await saved(field, value)).toBeNull();
      }
    );

    it('keeps an intentional zero', async () => {
      expect(await saved(field, 0)).toBe(0);
    });

    it('stores a numeric string as a number', async () => {
      expect(await saved(field, '300')).toBe(300);
    });
  });
});
