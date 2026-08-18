import { z } from "zod";
import { coachDietaryPatternSchema } from "../database/CoachProfiles.zod.ts";

const compactTextSchema = z.string().trim().min(1).max(100);
const compactTextListSchema = z.array(compactTextSchema).max(50);
export const coachLocalTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const updateCoachProfileRequestSchema = z.object({
  enabled: z.boolean(),
  dietaryPattern: coachDietaryPatternSchema,
  excludedIngredients: compactTextListSchema,
  preferredIngredients: compactTextListSchema,
  dislikedIngredients: compactTextListSchema,
  routines: compactTextListSchema,
  coachingNotes: z.string().trim().max(2_000).nullable(),
  dailyCheckInEnabled: z.boolean(),
  dailyCheckInTime: coachLocalTimeSchema,
  weeklyReviewEnabled: z.boolean(),
  weeklyReviewDay: z.number().int().min(0).max(6),
  weeklyReviewTime: coachLocalTimeSchema,
});

export const coachProfileResponseSchema =
  updateCoachProfileRequestSchema.extend({
    primaryGoal: z.string().nullable(),
    calorieTarget: z.number().nullable(),
    proteinTargetG: z.number().nullable(),
    waterTargetMl: z.number().int().nullable(),
    updatedAt: z.string().datetime().nullable(),
  });

export const validateMealSuggestionRequestSchema = z.object({
  ingredients: z.array(compactTextSchema).min(1).max(100),
});

export const mealValidationViolationSchema = z.object({
  type: z.enum(["dietary_pattern", "excluded_ingredient", "allergen"]),
  ingredient: z.string(),
  matchedTerm: z.string(),
  reason: z.string(),
});

export const validateMealSuggestionResponseSchema = z.object({
  allowed: z.boolean(),
  violations: z.array(mealValidationViolationSchema),
});

export type UpdateCoachProfileRequest = z.infer<
  typeof updateCoachProfileRequestSchema
>;
export type CoachProfileResponse = z.infer<typeof coachProfileResponseSchema>;
export type ValidateMealSuggestionRequest = z.infer<
  typeof validateMealSuggestionRequestSchema
>;
export type MealValidationViolation = z.infer<
  typeof mealValidationViolationSchema
>;
export type ValidateMealSuggestionResponse = z.infer<
  typeof validateMealSuggestionResponseSchema
>;
