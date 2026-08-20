import { z } from "zod";

export const speedianceRegionSchema = z.enum(["EU", "Global"]);

const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD calendar day");

const speedianceRemoteIdSchema = z
  .string()
  .regex(/^\d+$/, "Expected a numeric Speediance identifier");

export const speedianceExerciseSearchRequestSchema = z.object({
  providerId: z.string().uuid().optional(),
  query: z.string().trim().max(120).optional().default(""),
  limit: z.number().int().min(1).max(100).optional().default(50),
});

export const speedianceExerciseSchema = z.object({
  groupId: speedianceRemoteIdSchema,
  variantId: speedianceRemoteIdSchema,
  title: z.string().min(1),
  category: z.string().nullable(),
  primaryMuscle: z.string().nullable(),
  accessories: z.array(speedianceRemoteIdSchema),
  accessoryNames: z.array(z.string().min(1)),
  deviceTypes: z.array(z.number().int().positive()),
  isUnilateral: z.boolean(),
  compatibleForWorkout: z.boolean(),
});

export const speedianceExerciseSearchResponseSchema = z.object({
  exercises: z.array(speedianceExerciseSchema),
  total: z.number().int().nonnegative(),
});

export const speedianceResistanceModeSchema = z.enum([
  "standard",
  "chains",
  "eccentric",
]);

export const speedianceWorkoutSetSchema = z.object({
  repetitions: z.number().int().min(1).max(99),
  targetRm: z.number().int().min(9).max(13).optional().default(12),
  mode: speedianceResistanceModeSchema.optional().default("standard"),
  restSeconds: z.number().int().min(0).max(300).optional().default(90),
});

export const speedianceWorkoutExerciseSchema = z.object({
  groupId: speedianceRemoteIdSchema,
  variantId: speedianceRemoteIdSchema,
  expectedTitle: z.string().trim().min(1).max(200),
  sets: z.array(speedianceWorkoutSetSchema).min(1).max(12),
});

export const speedianceCreateAndScheduleWorkoutRequestSchema = z.object({
  providerId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(100),
  scheduleDate: calendarDaySchema,
  exercises: z.array(speedianceWorkoutExerciseSchema).min(1).max(50),
  acknowledgedPreferenceIds: z
    .array(z.string().uuid())
    .max(50)
    .optional()
    .default([]),
});

export const speedianceCreateAndScheduleWorkoutResponseSchema = z.object({
  success: z.literal(true),
  workout: z.object({
    id: speedianceRemoteIdSchema,
    code: z.string().min(1),
    name: z.string().min(1),
    created: z.boolean(),
    exerciseCount: z.number().int().positive(),
    remoteSetCount: z.number().int().positive(),
  }),
  schedule: z.object({
    date: calendarDaySchema,
    status: z.enum(["scheduled", "already_scheduled"]),
  }),
});

export const speedianceSyncRequestSchema = z
  .object({
    providerId: z.string().uuid().optional(),
    startDate: calendarDaySchema.optional(),
    endDate: calendarDaySchema.optional(),
    fullSync: z.boolean().optional().default(false),
  })
  .superRefine((value, ctx) => {
    if (
      (value.startDate && !value.endDate) ||
      (!value.startDate && value.endDate)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "startDate and endDate must be provided together",
        path: value.startDate ? ["endDate"] : ["startDate"],
      });
    }

    if (value.startDate && value.endDate && value.startDate > value.endDate) {
      ctx.addIssue({
        code: "custom",
        message: "startDate must be on or before endDate",
        path: ["startDate"],
      });
    }
  });

export const speedianceSyncResponseSchema = z.object({
  success: z.literal(true),
  importedWorkouts: z.number().int().nonnegative(),
  importedExercises: z.number().int().nonnegative(),
  skippedWorkouts: z.number().int().nonnegative(),
  startDate: calendarDaySchema,
  endDate: calendarDaySchema,
});

export const speedianceStatusResponseSchema = z.object({
  connected: z.boolean(),
  active: z.boolean(),
  region: speedianceRegionSchema.nullable(),
  lastSyncAt: z.string().datetime().nullable(),
});

export type SpeedianceRegion = z.infer<typeof speedianceRegionSchema>;
export type SpeedianceSyncRequest = z.infer<typeof speedianceSyncRequestSchema>;
export type SpeedianceSyncResponse = z.infer<
  typeof speedianceSyncResponseSchema
>;
export type SpeedianceStatusResponse = z.infer<
  typeof speedianceStatusResponseSchema
>;
export type SpeedianceExerciseSearchRequest = z.infer<
  typeof speedianceExerciseSearchRequestSchema
>;
export type SpeedianceExercise = z.infer<typeof speedianceExerciseSchema>;
export type SpeedianceExerciseSearchResponse = z.infer<
  typeof speedianceExerciseSearchResponseSchema
>;
export type SpeedianceResistanceMode = z.infer<
  typeof speedianceResistanceModeSchema
>;
export type SpeedianceWorkoutSet = z.infer<typeof speedianceWorkoutSetSchema>;
export type SpeedianceWorkoutExercise = z.infer<
  typeof speedianceWorkoutExerciseSchema
>;
export type SpeedianceCreateAndScheduleWorkoutRequest = z.infer<
  typeof speedianceCreateAndScheduleWorkoutRequestSchema
>;
export type SpeedianceCreateAndScheduleWorkoutResponse = z.infer<
  typeof speedianceCreateAndScheduleWorkoutResponseSchema
>;
