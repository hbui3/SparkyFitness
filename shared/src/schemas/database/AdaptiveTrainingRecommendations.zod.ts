import { z } from "zod";

export const adaptiveTrainingRecommendationKindSchema = z.enum([
  "workout",
  "recovery",
]);

export const adaptiveTrainingRecommendationStatusSchema = z.enum([
  "planned",
  "accepted",
  "skipped",
  "completed",
]);

export const adaptiveTrainingRecommendationsSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  recommendation_date: z.union([z.date(), z.string()]),
  kind: adaptiveTrainingRecommendationKindSchema,
  workout_preset_id: z.number().int().positive().nullable(),
  status: adaptiveTrainingRecommendationStatusSchema,
  score: z.number().min(0).max(100),
  volume_factor: z.number().min(0.5).max(1.25),
  muscle_load_snapshot: z.record(z.string(), z.unknown()),
  workout_snapshot: z.record(z.string(), z.unknown()).nullable(),
  rationale: z.array(z.record(z.string(), z.unknown())),
  settings_snapshot: z.record(z.string(), z.unknown()),
  algorithm_version: z.string(),
  generated_at: z.date(),
  updated_at: z.date(),
});

export type AdaptiveTrainingRecommendations = z.infer<
  typeof adaptiveTrainingRecommendationsSchema
>;
