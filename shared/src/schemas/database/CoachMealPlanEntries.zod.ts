import { z } from "zod";
import {
  coachMealPlanningDaySchema,
  coachMealPlanningQuantitySchema,
} from "./CoachPantryItems.zod.ts";

export const coachMealSlotSchema = z.enum([
  "breakfast",
  "lunch",
  "dinner",
  "snack",
]);

export const coachMealPlanEntryStatusSchema = z.enum([
  "planned",
  "prepared",
  "eaten_out",
  "replaced",
  "skipped",
]);

export const coachMealSafetyStatusSchema = z.enum([
  "validated",
  "needs_user_input",
]);

export const coachMealPlanEntriesSchema = z
  .object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    meal_plan_id: z.string().uuid(),
    plan_date: coachMealPlanningDaySchema,
    slot: coachMealSlotSchema,
    status: coachMealPlanEntryStatusSchema,
    recipe_key: z.string().trim().min(1).max(200),
    recipe_name: z.string().trim().min(1).max(300),
    recipe_description: z.string().trim().min(1).max(2_000).nullable(),
    recipe_instructions: z
      .array(z.string().trim().min(1).max(1_000))
      .min(1)
      .max(100),
    prep_minutes: z.number().int().min(0).max(1_440),
    servings: coachMealPlanningQuantitySchema.positive(),
    calories_kcal: coachMealPlanningQuantitySchema,
    protein_g: coachMealPlanningQuantitySchema,
    carbs_g: coachMealPlanningQuantitySchema,
    fat_g: coachMealPlanningQuantitySchema,
    safety_status: coachMealSafetyStatusSchema,
    replacement_for_id: z.string().uuid().nullable(),
    notes: z.string().trim().min(1).max(2_000).nullable(),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date(),
  })
  .strict();

export type CoachMealSlot = z.infer<typeof coachMealSlotSchema>;
export type CoachMealPlanEntryStatus = z.infer<
  typeof coachMealPlanEntryStatusSchema
>;
export type CoachMealSafetyStatus = z.infer<typeof coachMealSafetyStatusSchema>;
export type CoachMealPlanEntry = z.infer<typeof coachMealPlanEntriesSchema>;
