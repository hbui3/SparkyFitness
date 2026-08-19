import { z } from "zod";

export const adaptiveTrainingDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/);

export const adaptiveTrainingMuscleStatusSchema = z.enum([
  "ready",
  "light",
  "moderate",
  "high",
]);

export const adaptiveTrainingReasonCodeSchema = z.enum([
  "muscles_ready",
  "preferred_muscles",
  "within_duration",
  "weekly_target_reached",
  "trained_yesterday",
  "low_readiness",
  "poor_sleep",
  "no_eligible_presets",
  "insufficient_muscle_data",
  "adaptive_disabled",
]);

export const adaptiveTrainingReasonSchema = z.object({
  code: adaptiveTrainingReasonCodeSchema,
  muscles: z.array(z.string()).default([]),
  value: z.number().nullable().default(null),
});

export const adaptiveTrainingSettingsResponseSchema = z.object({
  enabled: z.boolean(),
  sessionsPerWeek: z.number().int().min(1).max(7),
  maxDurationMinutes: z.number().int().min(15).max(180),
  recoveryWindowHours: z.number().int().min(24).max(168),
  preferredMuscles: z.array(z.string().trim().min(1)).max(50),
  candidateWorkoutPresetIds: z.array(z.number().int().positive()),
  avoidConsecutiveTrainingDays: z.boolean(),
});

export const updateAdaptiveTrainingSettingsRequestSchema =
  adaptiveTrainingSettingsResponseSchema;

export const adaptiveTrainingMuscleLoadSchema = z.object({
  muscle: z.string(),
  loadScore: z.number().min(0).max(100),
  status: adaptiveTrainingMuscleStatusSchema,
  lastTrainedOn: adaptiveTrainingDaySchema.nullable(),
  recentVolumeKg: z.number().nonnegative(),
  recentSets: z.number().int().nonnegative(),
  sources: z.array(z.string()),
});

export const adaptiveTrainingPresetSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  description: z.string().nullable(),
  estimatedDurationMinutes: z.number().int().positive(),
  exerciseCount: z.number().int().nonnegative(),
  primaryMuscles: z.array(z.string()),
  secondaryMuscles: z.array(z.string()),
});

export const adaptiveTrainingReadinessSchema = z.object({
  score: z.number().min(0).max(100),
  sleepHours: z.number().nullable(),
  sleepScore: z.number().nullable(),
  trainingReadinessScore: z.number().nullable(),
});

export const adaptiveTrainingRecommendationSchema = z.object({
  id: z.string().uuid(),
  date: adaptiveTrainingDaySchema,
  kind: z.enum(["workout", "recovery"]),
  presetId: z.number().int().positive().nullable(),
  presetName: z.string().nullable(),
  score: z.number().min(0).max(100),
  status: z.enum(["planned", "accepted", "skipped", "completed"]),
  volumeFactor: z.number().min(0.5).max(1.25),
  rationale: z.array(adaptiveTrainingReasonSchema),
  algorithmVersion: z.string(),
  generatedAt: z.string().datetime(),
});

export const adaptiveTrainingDashboardResponseSchema = z.object({
  date: adaptiveTrainingDaySchema,
  settings: adaptiveTrainingSettingsResponseSchema,
  readiness: adaptiveTrainingReadinessSchema,
  muscleLoad: z.array(adaptiveTrainingMuscleLoadSchema),
  recommendation: adaptiveTrainingRecommendationSchema,
  availablePresets: z.array(adaptiveTrainingPresetSchema),
  hiddenDuplicateWorkouts: z.number().int().nonnegative(),
});

export const regenerateAdaptiveTrainingRequestSchema = z.object({
  date: adaptiveTrainingDaySchema.optional(),
});

export const updateAdaptiveTrainingRecommendationStatusRequestSchema = z.object(
  {
    status: z.enum(["planned", "accepted", "skipped", "completed"]),
  },
);

export type AdaptiveTrainingReason = z.infer<
  typeof adaptiveTrainingReasonSchema
>;
export type AdaptiveTrainingSettingsResponse = z.infer<
  typeof adaptiveTrainingSettingsResponseSchema
>;
export type UpdateAdaptiveTrainingSettingsRequest = z.infer<
  typeof updateAdaptiveTrainingSettingsRequestSchema
>;
export type AdaptiveTrainingMuscleLoad = z.infer<
  typeof adaptiveTrainingMuscleLoadSchema
>;
export type AdaptiveTrainingPreset = z.infer<
  typeof adaptiveTrainingPresetSchema
>;
export type AdaptiveTrainingReadiness = z.infer<
  typeof adaptiveTrainingReadinessSchema
>;
export type AdaptiveTrainingRecommendation = z.infer<
  typeof adaptiveTrainingRecommendationSchema
>;
export type AdaptiveTrainingDashboardResponse = z.infer<
  typeof adaptiveTrainingDashboardResponseSchema
>;
export type RegenerateAdaptiveTrainingRequest = z.infer<
  typeof regenerateAdaptiveTrainingRequestSchema
>;
export type UpdateAdaptiveTrainingRecommendationStatusRequest = z.infer<
  typeof updateAdaptiveTrainingRecommendationStatusRequestSchema
>;
