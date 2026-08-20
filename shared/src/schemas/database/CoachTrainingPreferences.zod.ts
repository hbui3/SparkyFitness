import { z } from "zod";

export const coachTrainingPreferenceKindSchema = z.enum([
  "exercise",
  "equipment",
  "training_style",
  "schedule",
  "constraint",
]);

export const coachTrainingPreferenceSentimentSchema = z.enum([
  "prefer",
  "avoid",
  "require",
  "neutral",
]);

export const coachTrainingPreferenceSourceSchema = z.enum([
  "user",
  "feedback",
  "coach",
]);

export const coachTrainingPreferencesSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  kind: coachTrainingPreferenceKindSchema,
  subject: z.string().trim().min(1).max(200),
  sentiment: coachTrainingPreferenceSentimentSchema,
  notes: z.string().trim().min(1).max(1000).nullable(),
  source: coachTrainingPreferenceSourceSchema,
  source_feedback_id: z.string().uuid().nullable(),
  active: z.boolean(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export type CoachTrainingPreferenceKind = z.infer<
  typeof coachTrainingPreferenceKindSchema
>;
export type CoachTrainingPreferenceSentiment = z.infer<
  typeof coachTrainingPreferenceSentimentSchema
>;
export type CoachTrainingPreferenceSource = z.infer<
  typeof coachTrainingPreferenceSourceSchema
>;
export type CoachTrainingPreference = z.infer<
  typeof coachTrainingPreferencesSchema
>;
