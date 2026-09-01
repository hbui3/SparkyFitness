import { z } from "zod";
import { isDayString } from "../../utils/timezone.ts";

export const coachMealPlanningUnitSchema = z.enum([
  "g",
  "ml",
  "piece",
  "tsp",
  "tbsp",
]);

export const coachMealPlanningCategorySchema = z.enum([
  "chilled",
  "produce",
  "pantry",
  "frozen",
  "other",
]);

export const coachMealPlanningRetailerSchema = z.enum(["coop", "migros"]);

export const coachMealPlanningDaySchema = z
  .string()
  .refine(isDayString, "Expected a valid YYYY-MM-DD calendar day");

export const coachMealPlanningQuantitySchema = z
  .number()
  .finite()
  .min(0)
  .max(999_999_999.999);

export const coachPantryItemsSchema = z
  .object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    ingredient_key: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    quantity: coachMealPlanningQuantitySchema,
    minimum_quantity: coachMealPlanningQuantitySchema,
    unit: coachMealPlanningUnitSchema,
    category: coachMealPlanningCategorySchema,
    preferred_retailer: coachMealPlanningRetailerSchema.nullable(),
    preferred_retailer_product_id: z.string().trim().min(1).max(200).nullable(),
    expires_on: coachMealPlanningDaySchema.nullable(),
    is_active: z.boolean(),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date(),
  })
  .strict()
  .refine(
    (value) =>
      (value.preferred_retailer === null) ===
      (value.preferred_retailer_product_id === null),
    {
      message: "Preferred retailer and product id must be supplied together",
      path: ["preferred_retailer_product_id"],
    },
  );

export type CoachMealPlanningUnit = z.infer<typeof coachMealPlanningUnitSchema>;
export type CoachMealPlanningCategory = z.infer<
  typeof coachMealPlanningCategorySchema
>;
export type CoachMealPlanningRetailer = z.infer<
  typeof coachMealPlanningRetailerSchema
>;
export type CoachPantryItem = z.infer<typeof coachPantryItemsSchema>;
