import { z } from "zod";

export const adaptiveTrainingSettingsSchema = z.object({
  user_id: z.string().uuid(),
  enabled: z.boolean(),
  sessions_per_week: z.number().int().min(1).max(7),
  max_duration_minutes: z.number().int().min(15).max(180),
  recovery_window_hours: z.number().int().min(24).max(168),
  preferred_muscles: z.array(z.string().trim().min(1)).max(50),
  candidate_workout_preset_ids: z.array(z.number().int().positive()),
  avoid_consecutive_training_days: z.boolean(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const adaptiveTrainingSettingsInitializerSchema =
  adaptiveTrainingSettingsSchema
    .omit({ created_at: true, updated_at: true })
    .extend({
      enabled: z.boolean().optional(),
      sessions_per_week: z.number().int().min(1).max(7).optional(),
      max_duration_minutes: z.number().int().min(15).max(180).optional(),
      recovery_window_hours: z.number().int().min(24).max(168).optional(),
      preferred_muscles: z.array(z.string().trim().min(1)).max(50).optional(),
      candidate_workout_preset_ids: z
        .array(z.number().int().positive())
        .optional(),
      avoid_consecutive_training_days: z.boolean().optional(),
    });

export type AdaptiveTrainingSettings = z.infer<
  typeof adaptiveTrainingSettingsSchema
>;
export type AdaptiveTrainingSettingsInitializer = z.infer<
  typeof adaptiveTrainingSettingsInitializerSchema
>;
