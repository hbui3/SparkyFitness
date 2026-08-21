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
  completionMethod: z.number().int().nullable().optional(),
  selectCompletionMethod: z.number().int().nullable().optional(),
  dataStatType: z.number().int().nullable().optional(),
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

export const speedianceTemplatePresetSchema = z.union([
  z.literal(-1),
  z.literal(0),
  z.literal(1),
  z.literal(3),
  z.literal(5),
]);

export const speedianceCompletionUnitSchema = z.enum([
  "repetitions",
  "seconds",
  "calories",
]);

export const speedianceSetTypeSchema = z.enum(["warmup", "working"]);

export const speedianceWorkoutSetSchema = z.object({
  repetitions: z.number().int().min(1).max(99),
  targetRm: z.number().int().min(1).max(30).optional().default(12),
  weightKg: z.number().min(0).max(250).optional(),
  durationSeconds: z.number().int().min(1).max(7200).optional(),
  calorieTarget: z.number().int().min(1).max(5000).optional(),
  level: z.number().int().min(1).max(10).optional(),
  setType: speedianceSetTypeSchema.optional(),
  mode: speedianceResistanceModeSchema.optional().default("standard"),
  restSeconds: z.number().int().min(0).max(300).optional().default(90),
});

export const speedianceWorkoutExerciseSchema = z.object({
  groupId: speedianceRemoteIdSchema,
  variantId: speedianceRemoteIdSchema,
  expectedTitle: z.string().trim().min(1).max(200),
  category: z.string().nullable().optional(),
  primaryMuscle: z.string().nullable().optional(),
  accessoryNames: z.array(z.string().min(1)).optional(),
  dataStatType: z.number().int().nullable().optional(),
  presetId: speedianceTemplatePresetSchema.optional(),
  completionUnit: speedianceCompletionUnitSchema.optional(),
  sets: z.array(speedianceWorkoutSetSchema).min(1).max(12),
});

export const speedianceWorkoutDefinitionSchema = z.object({
  providerId: z.string().uuid().optional(),
  remoteId: speedianceRemoteIdSchema.optional(),
  remoteCode: z.string().trim().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(100),
  exercises: z.array(speedianceWorkoutExerciseSchema).min(1).max(50),
  acknowledgedPreferenceIds: z
    .array(z.string().uuid())
    .max(50)
    .optional()
    .default([]),
});

export const speedianceWorkoutSummarySchema = z.object({
  id: speedianceRemoteIdSchema,
  code: z.string().min(1),
  name: z.string().min(1),
  exerciseCount: z.number().int().nonnegative(),
  nativeWorkoutPresetId: z.number().int().positive().nullable(),
});

export const speedianceWorkoutDetailSchema =
  speedianceWorkoutSummarySchema.extend({
    exercises: z.array(speedianceWorkoutExerciseSchema),
  });

export const speedianceWorkoutListResponseSchema = z.object({
  workouts: z.array(speedianceWorkoutSummarySchema),
});

export const speedianceWorkoutUpsertResponseSchema = z.object({
  success: z.literal(true),
  workout: speedianceWorkoutSummarySchema.extend({
    created: z.boolean(),
    remoteSetCount: z.number().int().nonnegative(),
  }),
});

export const speedianceWorkoutScheduleRequestSchema = z.object({
  providerId: z.string().uuid().optional(),
  date: calendarDaySchema,
});

export const speedianceWorkoutScheduleResponseSchema = z.object({
  success: z.literal(true),
  code: z.string().min(1),
  date: calendarDaySchema,
  status: z.enum([
    "scheduled",
    "already_scheduled",
    "unscheduled",
    "already_unscheduled",
  ]),
});

export const speediancePlanSessionSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  workout: speedianceWorkoutDefinitionSchema.omit({ providerId: true }),
});

export const speedianceCreatePlanRequestSchema = z
  .object({
    providerId: z.string().uuid().optional(),
    planName: z.string().trim().min(1).max(100),
    description: z.string().trim().max(1000).optional().default(""),
    startDate: calendarDaySchema,
    endDate: calendarDaySchema,
    sessions: z.array(speediancePlanSessionSchema).min(1).max(7),
  })
  .superRefine((value, ctx) => {
    if (value.endDate < value.startDate) {
      ctx.addIssue({
        code: "custom",
        message: "endDate must be on or after startDate",
        path: ["endDate"],
      });
    }
    const durationDays =
      (Date.parse(`${value.endDate}T00:00:00Z`) -
        Date.parse(`${value.startDate}T00:00:00Z`)) /
      86_400_000;
    if (durationDays > 366) {
      ctx.addIssue({
        code: "custom",
        message: "A synchronized Speediance plan cannot exceed 366 days",
        path: ["endDate"],
      });
    }
  });

export const speedianceCreatePlanResponseSchema = z.object({
  success: z.literal(true),
  plan: z.object({
    id: z.union([z.string(), z.number()]).transform(String),
    name: z.string(),
    startDate: calendarDaySchema,
    endDate: calendarDaySchema,
    workoutCount: z.number().int().positive(),
    scheduledDates: z.number().int().nonnegative(),
    failedDates: z.array(
      z.object({ date: calendarDaySchema, workoutName: z.string() }),
    ),
  }),
});

export const speedianceWorkoutDeleteRequestSchema = z.object({
  providerId: z.string().uuid().optional(),
  remoteCode: z.string().trim().min(1).max(200),
  confirmName: z.string().trim().min(1).max(100),
});

export const speedianceWorkoutDeleteResponseSchema = z.object({
  success: z.literal(true),
  id: speedianceRemoteIdSchema,
  code: z.string().min(1),
  name: z.string().min(1),
  nativeWorkoutPresetPreserved: z.literal(true),
});

export const speedianceManageWorkoutRequestSchema = z.discriminatedUnion(
  "action",
  [
    z.object({
      action: z.literal("list"),
      providerId: z.string().uuid().optional(),
    }),
    z.object({
      action: z.literal("get"),
      providerId: z.string().uuid().optional(),
      code: z.string().min(1),
    }),
    z.object({
      action: z.literal("upsert"),
      workout: speedianceWorkoutDefinitionSchema,
    }),
    z.object({
      action: z.literal("schedule"),
      providerId: z.string().uuid().optional(),
      code: z.string().min(1),
      date: calendarDaySchema,
    }),
    z.object({
      action: z.literal("unschedule"),
      providerId: z.string().uuid().optional(),
      code: z.string().min(1),
      date: calendarDaySchema,
    }),
    z.object({
      action: z.literal("create_plan"),
      plan: speedianceCreatePlanRequestSchema,
    }),
    z.object({
      action: z.literal("delete"),
      providerId: z.string().uuid().optional(),
      id: speedianceRemoteIdSchema,
      code: z.string().min(1),
      confirmName: z.string().trim().min(1).max(100),
    }),
  ],
);

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
export type SpeedianceTemplatePreset = z.infer<
  typeof speedianceTemplatePresetSchema
>;
export type SpeedianceCompletionUnit = z.infer<
  typeof speedianceCompletionUnitSchema
>;
export type SpeedianceWorkoutDefinition = z.infer<
  typeof speedianceWorkoutDefinitionSchema
>;
export type SpeedianceWorkoutSummary = z.infer<
  typeof speedianceWorkoutSummarySchema
>;
export type SpeedianceWorkoutDetail = z.infer<
  typeof speedianceWorkoutDetailSchema
>;
export type SpeedianceWorkoutListResponse = z.infer<
  typeof speedianceWorkoutListResponseSchema
>;
export type SpeedianceWorkoutUpsertResponse = z.infer<
  typeof speedianceWorkoutUpsertResponseSchema
>;
export type SpeedianceWorkoutScheduleRequest = z.infer<
  typeof speedianceWorkoutScheduleRequestSchema
>;
export type SpeedianceWorkoutScheduleResponse = z.infer<
  typeof speedianceWorkoutScheduleResponseSchema
>;
export type SpeedianceCreatePlanRequest = z.infer<
  typeof speedianceCreatePlanRequestSchema
>;
export type SpeedianceCreatePlanResponse = z.infer<
  typeof speedianceCreatePlanResponseSchema
>;
export type SpeedianceWorkoutDeleteRequest = z.infer<
  typeof speedianceWorkoutDeleteRequestSchema
>;
export type SpeedianceWorkoutDeleteResponse = z.infer<
  typeof speedianceWorkoutDeleteResponseSchema
>;
export type SpeedianceManageWorkoutRequest = z.infer<
  typeof speedianceManageWorkoutRequestSchema
>;
