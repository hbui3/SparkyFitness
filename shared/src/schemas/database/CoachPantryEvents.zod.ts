import { z } from "zod";
import { coachMealPlanningUnitSchema } from "./CoachPantryItems.zod.ts";

export const coachPantryEventTypeSchema = z.enum([
  "adjust",
  "purchase",
  "consume",
  "spoil",
]);

export const coachPantryEventSourceSchema = z.enum([
  "manual",
  "shopping",
  "meal_plan",
]);

export const coachPantryEventsSchema = z
  .object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    pantry_item_id: z.string().uuid(),
    event_type: coachPantryEventTypeSchema,
    delta_quantity: z
      .number()
      .finite()
      .min(-999_999_999.999)
      .max(999_999_999.999)
      .refine((value) => value !== 0, "Pantry event delta must not be zero"),
    unit: coachMealPlanningUnitSchema,
    source: coachPantryEventSourceSchema,
    source_id: z.string().uuid().nullable(),
    idempotency_key: z.string().trim().min(1).max(200),
    notes: z.string().trim().min(1).max(1_000).nullable(),
    created_at: z.coerce.date(),
  })
  .strict();

export type CoachPantryEventType = z.infer<typeof coachPantryEventTypeSchema>;
export type CoachPantryEventSource = z.infer<
  typeof coachPantryEventSourceSchema
>;
export type CoachPantryEvent = z.infer<typeof coachPantryEventsSchema>;
