import { z } from "zod";
import { coachMealPlanningDaySchema } from "./CoachPantryItems.zod.ts";

export const coachShoppingListStatusSchema = z.enum([
  "open",
  "completed",
  "cancelled",
]);

export const coachShoppingListsSchema = z
  .object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    coverage_start: coachMealPlanningDaySchema.nullable(),
    coverage_end: coachMealPlanningDaySchema.nullable(),
    status: coachShoppingListStatusSchema,
    completed_at: z.coerce.date().nullable(),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.coverage_start === null) !== (value.coverage_end === null)) {
      ctx.addIssue({
        code: "custom",
        message: "Shopping-list coverage dates must be supplied together",
        path: ["coverage_end"],
      });
      return;
    }
    if (
      value.coverage_start !== null &&
      value.coverage_end !== null &&
      value.coverage_end < value.coverage_start
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Shopping-list coverage end must not precede its start",
        path: ["coverage_end"],
      });
    }
  });

export type CoachShoppingListStatus = z.infer<
  typeof coachShoppingListStatusSchema
>;
export type CoachShoppingList = z.infer<typeof coachShoppingListsSchema>;
