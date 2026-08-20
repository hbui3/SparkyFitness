import { z } from "zod";
import {
  coachExerciseFeedbackSchema,
  coachWorkoutDifficultySchema,
  coachWorkoutProviderSchema,
} from "../database/CoachWorkoutFeedback.zod.ts";
import {
  coachTrainingPreferenceKindSchema,
  coachTrainingPreferenceSentimentSchema,
} from "../database/CoachTrainingPreferences.zod.ts";

const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD calendar day");

export const trainingPreferenceInputSchema = z.object({
  kind: coachTrainingPreferenceKindSchema,
  subject: z.string().trim().min(1).max(200),
  sentiment: coachTrainingPreferenceSentimentSchema,
  notes: z.string().trim().min(1).max(1000).optional(),
});

export const recordTrainingFeedbackRequestSchema = z
  .object({
    workoutDate: calendarDaySchema.optional(),
    workoutName: z.string().trim().min(1).max(200),
    provider: coachWorkoutProviderSchema.optional().default("speediance"),
    overallRating: z.number().int().min(1).max(5).optional(),
    difficulty: coachWorkoutDifficultySchema.optional(),
    energyRating: z.number().int().min(1).max(5).optional(),
    painLevel: z.number().int().min(0).max(10).optional(),
    notes: z.string().trim().min(1).max(2000).optional(),
    exerciseFeedback: z
      .array(coachExerciseFeedbackSchema)
      .max(30)
      .optional()
      .default([]),
    preferenceUpdates: z
      .array(trainingPreferenceInputSchema)
      .max(30)
      .optional()
      .default([]),
  })
  .superRefine((value, ctx) => {
    if (
      value.overallRating === undefined &&
      value.difficulty === undefined &&
      value.energyRating === undefined &&
      value.painLevel === undefined &&
      value.notes === undefined &&
      value.exerciseFeedback.length === 0 &&
      value.preferenceUpdates.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        message: "At least one feedback value is required",
      });
    }
  });

export const setTrainingPreferenceRequestSchema = trainingPreferenceInputSchema;

export const forgetTrainingPreferenceRequestSchema = z.object({
  preferenceId: z.string().uuid(),
});

export const trainingPreferenceResponseSchema = z.object({
  id: z.string().uuid(),
  kind: coachTrainingPreferenceKindSchema,
  subject: z.string(),
  sentiment: coachTrainingPreferenceSentimentSchema,
  notes: z.string().nullable(),
  source: z.enum(["user", "feedback", "coach"]),
  active: z.boolean(),
  updatedAt: z.string().datetime(),
});

export const trainingFeedbackResponseSchema = z.object({
  id: z.string().uuid(),
  workoutDate: calendarDaySchema,
  workoutName: z.string(),
  provider: coachWorkoutProviderSchema,
  overallRating: z.number().int().min(1).max(5).nullable(),
  difficulty: coachWorkoutDifficultySchema.nullable(),
  energyRating: z.number().int().min(1).max(5).nullable(),
  painLevel: z.number().int().min(0).max(10).nullable(),
  notes: z.string().nullable(),
  exerciseFeedback: z.array(coachExerciseFeedbackSchema),
  createdAt: z.string().datetime(),
});

export const trainingLearningContextSchema = z.object({
  suggestedVolumeFactor: z.number().min(0.8).max(1.1),
  suggestedRestSecondsDelta: z.number().int().min(0).max(30),
  recentPainReported: z.boolean(),
  preferredExercises: z.array(z.string()),
  avoidedExercises: z.array(z.string()),
  requiredEquipment: z.array(z.string()),
  constraints: z.array(z.string()),
  preferences: z.array(trainingPreferenceResponseSchema),
  recentFeedback: z.array(trainingFeedbackResponseSchema),
});

export const recordTrainingFeedbackResponseSchema = z.object({
  success: z.literal(true),
  feedback: trainingFeedbackResponseSchema,
  updatedPreferences: z.array(trainingPreferenceResponseSchema),
  learningContext: trainingLearningContextSchema,
});

export type TrainingPreferenceInput = z.infer<
  typeof trainingPreferenceInputSchema
>;
export type RecordTrainingFeedbackRequest = z.infer<
  typeof recordTrainingFeedbackRequestSchema
>;
export type SetTrainingPreferenceRequest = z.infer<
  typeof setTrainingPreferenceRequestSchema
>;
export type TrainingPreferenceResponse = z.infer<
  typeof trainingPreferenceResponseSchema
>;
export type TrainingFeedbackResponse = z.infer<
  typeof trainingFeedbackResponseSchema
>;
export type TrainingLearningContext = z.infer<
  typeof trainingLearningContextSchema
>;
export type RecordTrainingFeedbackResponse = z.infer<
  typeof recordTrainingFeedbackResponseSchema
>;
