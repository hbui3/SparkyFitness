import { z } from "zod";

export const coachWorkoutProviderSchema = z.enum([
  "speediance",
  "sparky",
  "manual",
  "other",
]);

export const coachWorkoutDifficultySchema = z.enum([
  "too_easy",
  "just_right",
  "too_hard",
]);

export const coachExerciseFeedbackSchema = z.object({
  exerciseName: z.string().trim().min(1).max(200),
  rating: z.number().int().min(1).max(5).optional(),
  difficulty: coachWorkoutDifficultySchema.optional(),
  discomfortLevel: z.number().int().min(0).max(10).optional(),
  notes: z.string().trim().min(1).max(500).optional(),
});

export const coachWorkoutFeedbackSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  workout_date: z.union([z.date(), z.string()]),
  workout_name: z.string().trim().min(1).max(200),
  provider: coachWorkoutProviderSchema,
  overall_rating: z.number().int().min(1).max(5).nullable(),
  difficulty: coachWorkoutDifficultySchema.nullable(),
  energy_rating: z.number().int().min(1).max(5).nullable(),
  pain_level: z.number().int().min(0).max(10).nullable(),
  notes: z.string().trim().min(1).max(2000).nullable(),
  exercise_feedback: z.array(coachExerciseFeedbackSchema).max(30),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export type CoachWorkoutProvider = z.infer<typeof coachWorkoutProviderSchema>;
export type CoachWorkoutDifficulty = z.infer<
  typeof coachWorkoutDifficultySchema
>;
export type CoachExerciseFeedback = z.infer<typeof coachExerciseFeedbackSchema>;
export type CoachWorkoutFeedback = z.infer<typeof coachWorkoutFeedbackSchema>;
