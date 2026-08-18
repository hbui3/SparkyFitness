import { tool } from 'ai';
import { validateMealSuggestionRequestSchema } from '@workspace/shared';
import { log } from '../../config/logging.js';
import coachProfileService from '../../services/coachProfileService.js';
import { ERRORS, formatZodError } from './errors.js';
import { formatSuccess } from './formatting.js';

export function buildMealSafetyTools(userId: string) {
  return {
    sparky_validate_meal_suggestion: tool({
      description:
        'Required before presenting a new meal or recipe suggestion. Deterministically checks the complete ingredient list against the user’s private dietary pattern, excluded ingredients, and tracked allergens. If blocked, revise the suggestion and validate again.',
      inputSchema: validateMealSuggestionRequestSchema,
      execute: async (rawArgs) => {
        const parsed = validateMealSuggestionRequestSchema.safeParse(rawArgs);
        if (!parsed.success) return formatZodError(parsed.error);
        try {
          const result = await coachProfileService.validateMealSuggestion(
            userId,
            parsed.data.ingredients
          );
          return formatSuccess(result, 'Meal Safety Validation');
        } catch (error) {
          log('error', '[Meal Safety Tool] validation error:', error);
          return ERRORS.DB_ERROR(error);
        }
      },
    }),
  };
}
