import { z } from "zod";
import { coachDietaryPatternSchema } from "../database/CoachProfiles.zod.ts";
import { coachMemoryCategorySchema } from "../database/CoachMemories.zod.ts";

const compactTextSchema = z.string().trim().min(1).max(100);
const compactTextListSchema = z.array(compactTextSchema).max(50);
export const coachLocalTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const proactiveCoachCategorySchema = z.enum([
  "nutrition",
  "hydration",
  "training",
  "recovery",
]);

const coachProfileInputShape = {
  enabled: z.boolean(),
  dietaryPattern: coachDietaryPatternSchema,
  excludedIngredients: compactTextListSchema,
  preferredIngredients: compactTextListSchema,
  dislikedIngredients: compactTextListSchema,
  routines: compactTextListSchema,
  coachingNotes: z.string().trim().max(2_000).nullable(),
  adaptiveCheckInsEnabled: z.boolean().default(false),
  adaptiveStartTime: coachLocalTimeSchema.default("07:00"),
  adaptiveEndTime: coachLocalTimeSchema.default("20:00"),
  adaptiveIntervalMinutes: z.number().int().min(30).max(360).default(120),
  proactiveCategories: z
    .array(proactiveCoachCategorySchema)
    .min(1)
    .max(4)
    .default(["nutrition", "hydration", "training", "recovery"]),
  memoryEnabled: z.boolean().default(true),
  autoMemoryEnabled: z.boolean().default(false),
  dailyCheckInEnabled: z.boolean(),
  dailyCheckInTime: coachLocalTimeSchema,
  weeklyReviewEnabled: z.boolean(),
  weeklyReviewDay: z.number().int().min(0).max(6),
  weeklyReviewTime: coachLocalTimeSchema,
};

function validAdaptiveWindow(value: {
  adaptiveStartTime: string;
  adaptiveEndTime: string;
}): boolean {
  return value.adaptiveStartTime < value.adaptiveEndTime;
}

export const updateCoachProfileRequestSchema = z
  .object(coachProfileInputShape)
  .refine(validAdaptiveWindow, {
    path: ["adaptiveEndTime"],
    message: "Adaptive end time must be later than start time",
  });

export const coachProfileResponseSchema = z
  .object({
    ...coachProfileInputShape,
    primaryGoal: z.string().nullable(),
    calorieTarget: z.number().nullable(),
    proteinTargetG: z.number().nullable(),
    waterTargetMl: z.number().int().nullable(),
    updatedAt: z.string().datetime().nullable(),
  })
  .refine(validAdaptiveWindow, {
    path: ["adaptiveEndTime"],
    message: "Adaptive end time must be later than start time",
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

export const coachMemoryResponseSchema = z.object({
  id: z.string().uuid(),
  category: coachMemoryCategorySchema,
  content: z.string(),
  source: z.enum(["user", "coach", "import"]),
  active: z.boolean(),
  pinned: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createCoachMemoryRequestSchema = z.object({
  category: coachMemoryCategorySchema,
  content: z.string().trim().min(1).max(500),
  pinned: z.boolean().default(false),
});

export const updateCoachMemoryRequestSchema = z
  .object({
    category: coachMemoryCategorySchema.optional(),
    content: z.string().trim().min(1).max(500).optional(),
    active: z.boolean().optional(),
    pinned: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "No changes supplied");

export const coachTodayStatusResponseSchema = z.object({
  date: z.string(),
  timezone: z.string(),
  caloriesConsumed: z.number(),
  caloriesBurned: z.number(),
  netCalories: z.number(),
  calorieTarget: z.number().nullable(),
  caloriesRemaining: z.number().nullable(),
  proteinConsumedG: z.number(),
  proteinTargetG: z.number().nullable(),
  proteinRemainingG: z.number().nullable(),
  waterConsumedMl: z.number(),
  waterTargetMl: z.number().nullable(),
  waterRemainingMl: z.number().nullable(),
  nextAction: z.string(),
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
export type ProactiveCoachCategory = z.infer<
  typeof proactiveCoachCategorySchema
>;
export type CoachMemoryResponse = z.infer<typeof coachMemoryResponseSchema>;
export type CreateCoachMemoryRequest = z.infer<
  typeof createCoachMemoryRequestSchema
>;
export type UpdateCoachMemoryRequest = z.infer<
  typeof updateCoachMemoryRequestSchema
>;
export type CoachTodayStatusResponse = z.infer<
  typeof coachTodayStatusResponseSchema
>;
