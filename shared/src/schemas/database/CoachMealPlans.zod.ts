import { z } from "zod";
import { coachMealPlanningDaySchema } from "./CoachPantryItems.zod.ts";

export const coachMealPlanStatusSchema = z.enum([
  "active",
  "completed",
  "archived",
]);

export const coachMealPlanSourceSchema = z.enum(["coach", "user"]);

export const coachMealPlansSchema = z
  .object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    start_date: coachMealPlanningDaySchema,
    end_date: coachMealPlanningDaySchema,
    status: coachMealPlanStatusSchema,
    source: coachMealPlanSourceSchema,
    algorithm_version: z.string().trim().min(1).max(100),
    generation_key: z.string().trim().min(1).max(200),
    warnings: z.array(z.string().trim().min(1).max(1_000)),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date(),
  })
  .strict()
  .refine(
    (value) => {
      const start = Date.parse(`${value.start_date}T00:00:00Z`);
      const end = Date.parse(`${value.end_date}T00:00:00Z`);
      const durationDays = (end - start) / 86_400_000;
      return durationDays >= 0 && durationDays <= 6;
    },
    {
      message: "Meal plan must cover between one and seven calendar days",
      path: ["end_date"],
    },
  );

export type CoachMealPlanStatus = z.infer<typeof coachMealPlanStatusSchema>;
export type CoachMealPlanSource = z.infer<typeof coachMealPlanSourceSchema>;
export type CoachMealPlan = z.infer<typeof coachMealPlansSchema>;
