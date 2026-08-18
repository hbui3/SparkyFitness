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
  primary_goal: z.string().nullable(),
  calorie_target: z.number().nullable(),
  protein_target_g: z.number().nullable(),
  water_target_ml: z.number().int().nullable(),
  excluded_ingredients: z.array(z.string()),
  preferred_ingredients: z.array(z.string()),
  disliked_ingredients: z.array(z.string()),
  routines: z.array(z.string()),
  coaching_notes: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const coachProfilesInitializerSchema = coachProfilesSchema
  .omit({ id: true, created_at: true, updated_at: true })
  .extend({
    id: coachProfilesIdSchema.optional(),
    enabled: z.boolean().optional(),
    dietary_pattern: coachDietaryPatternSchema.optional(),
    primary_goal: z.string().nullable().optional(),
    calorie_target: z.number().nullable().optional(),
    protein_target_g: z.number().nullable().optional(),
    water_target_ml: z.number().int().nullable().optional(),
    excluded_ingredients: z.array(z.string()).optional(),
    preferred_ingredients: z.array(z.string()).optional(),
    disliked_ingredients: z.array(z.string()).optional(),
    routines: z.array(z.string()).optional(),
    coaching_notes: z.string().nullable().optional(),
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
