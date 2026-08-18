import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMealSafetyTools } from '../ai/tools/mealSafetyTools.js';
import coachProfileService from '../services/coachProfileService.js';

vi.mock('../services/coachProfileService.js', () => ({
  default: { validateMealSuggestion: vi.fn() },
}));

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

describe('sparky_validate_meal_suggestion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the deterministic validation result', async () => {
    vi.mocked(coachProfileService.validateMealSuggestion).mockResolvedValue({
      allowed: false,
      violations: [
        {
          type: 'excluded_ingredient',
          ingredient: 'tofu',
          matchedTerm: 'tofu',
          reason: 'blocked',
        },
      ],
    });
    const tool = buildMealSafetyTools('user-1').sparky_validate_meal_suggestion;

    const result = await tool.execute!(
      { ingredients: ['tofu'] },
      { toolCallId: 'call-1', messages: [] }
    );

    expect(result).toContain('"allowed": false');
    expect(coachProfileService.validateMealSuggestion).toHaveBeenCalledWith(
      'user-1',
      ['tofu']
    );
  });

  it('rejects an empty ingredient list before calling the service', async () => {
    const tool = buildMealSafetyTools('user-1').sparky_validate_meal_suggestion;

    const result = await tool.execute!(
      { ingredients: [] },
      { toolCallId: 'call-1', messages: [] }
    );

    expect(result).toContain('Error [VALIDATION]');
    expect(coachProfileService.validateMealSuggestion).not.toHaveBeenCalled();
  });
});
