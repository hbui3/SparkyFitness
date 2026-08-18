import { z } from "zod";

export const coachProfilesIdSchema = z.string().and(
  z.object({
    __brand: z.literal("public.coach_profiles"),
  }),
);

export const coachDietaryPatternSchema = z.enum([
  "omnivore",
  "vegetarian",
  "vegan",
  "pescatarian",
  "other",
]);

export const coachProfilesSchema = z.object({
  id: coachProfilesIdSchema,
  user_id: z.string(),
  enabled: z.boolean(),
  dietary_pattern: coachDietaryPatternSchema,
  excluded_ingredients: z.array(z.string()),
  preferred_ingredients: z.array(z.string()),
  disliked_ingredients: z.array(z.string()),
  routines: z.array(z.string()),
  coaching_notes: z.string().nullable(),
  adaptive_check_ins_enabled: z.boolean(),
  adaptive_last_sent_slot: z.string().nullable(),
  daily_check_in_enabled: z.boolean(),
  daily_check_in_time: z.string(),
  weekly_review_enabled: z.boolean(),
  weekly_review_day: z.number().int().min(0).max(6),
  weekly_review_time: z.string(),
  daily_last_sent_on: z.union([z.date(), z.string()]).nullable(),
  weekly_last_sent_on: z.union([z.date(), z.string()]).nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const coachProfilesInitializerSchema = coachProfilesSchema
  .omit({ id: true, created_at: true, updated_at: true })
  .extend({
    id: coachProfilesIdSchema.optional(),
    enabled: z.boolean().optional(),
    dietary_pattern: coachDietaryPatternSchema.optional(),
    excluded_ingredients: z.array(z.string()).optional(),
    preferred_ingredients: z.array(z.string()).optional(),
    disliked_ingredients: z.array(z.string()).optional(),
    routines: z.array(z.string()).optional(),
    coaching_notes: z.string().nullable().optional(),
    adaptive_check_ins_enabled: z.boolean().optional(),
    adaptive_last_sent_slot: z.string().nullable().optional(),
    daily_check_in_enabled: z.boolean().optional(),
    daily_check_in_time: z.string().optional(),
    weekly_review_enabled: z.boolean().optional(),
    weekly_review_day: z.number().int().min(0).max(6).optional(),
    weekly_review_time: z.string().optional(),
    daily_last_sent_on: z.union([z.date(), z.string()]).nullable().optional(),
    weekly_last_sent_on: z.union([z.date(), z.string()]).nullable().optional(),
    created_at: z.date().optional(),
    updated_at: z.date().optional(),
  });

export const coachProfilesMutatorSchema = coachProfilesInitializerSchema
  .omit({ user_id: true })
  .extend({ user_id: z.string().optional() });

export type CoachDietaryPattern = z.infer<typeof coachDietaryPatternSchema>;
export type CoachProfiles = z.infer<typeof coachProfilesSchema>;
export type CoachProfilesInitializer = z.infer<
  typeof coachProfilesInitializerSchema
>;
export type CoachProfilesMutator = z.infer<typeof coachProfilesMutatorSchema>;
