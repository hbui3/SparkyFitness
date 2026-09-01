import { z } from "zod";
import {
  coachMealPlanningCategorySchema,
  coachMealPlanningQuantitySchema,
  coachMealPlanningUnitSchema,
} from "./CoachPantryItems.zod.ts";

export const coachMealPlanIngredientsSchema = z
  .object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    meal_plan_entry_id: z.string().uuid(),
    pantry_item_id: z.string().uuid().nullable(),
    ingredient_key: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    quantity: coachMealPlanningQuantitySchema.positive(),
    unit: coachMealPlanningUnitSchema,
    category: coachMealPlanningCategorySchema,
    shopping_required: z.boolean(),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date(),
  })
  .strict();

export type CoachMealPlanIngredient = z.infer<
  typeof coachMealPlanIngredientsSchema
>;
