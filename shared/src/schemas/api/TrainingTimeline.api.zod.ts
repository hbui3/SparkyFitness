import { z } from "zod";

const calendarDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const trainingTimelineQuerySchema = z
  .object({
    startDate: calendarDaySchema.optional(),
    endDate: calendarDaySchema.optional(),
  })
  .refine(
    ({ startDate, endDate }) =>
      (startDate === undefined && endDate === undefined) ||
      (startDate !== undefined && endDate !== undefined),
    { message: "startDate and endDate must be provided together" },
  );

export const trainingTimelineItemSchema = z.object({
  id: z.string(),
  date: calendarDaySchema,
  name: z.string(),
  source: z.string(),
  status: z.enum(["completed", "planned", "missed"]),
  workoutPresetId: z.number().int().positive().nullable(),
  workoutPlanAssignmentId: z.number().int().positive().nullable(),
  exerciseCount: z.number().int().nonnegative(),
  totalSetCount: z.number().int().nonnegative(),
  warmupSetCount: z.number().int().nonnegative(),
  workingSetCount: z.number().int().nonnegative(),
});

export const activeTrainingPlanSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  description: z.string().nullable(),
  startDate: calendarDaySchema,
  endDate: calendarDaySchema.nullable(),
  assignments: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      presetId: z.number().int().positive().nullable(),
      workoutName: z.string(),
      exerciseCount: z.number().int().nonnegative(),
      totalSetCount: z.number().int().nonnegative(),
      warmupSetCount: z.number().int().nonnegative(),
      workingSetCount: z.number().int().nonnegative(),
    }),
  ),
});

export const trainingDaySummarySchema = z.object({
  date: calendarDaySchema,
  status: z.enum(["completed", "in_progress", "planned", "missed"]),
  scheduledWorkoutCount: z.number().int().nonnegative(),
  completedScheduledWorkoutCount: z.number().int().nonnegative(),
  completedWorkoutCount: z.number().int().nonnegative(),
  scheduledExerciseCount: z.number().int().nonnegative(),
  completedScheduledExerciseCount: z.number().int().nonnegative(),
  scheduledSetCount: z.number().int().nonnegative(),
  completedScheduledSetCount: z.number().int().nonnegative(),
  scheduledWarmupSetCount: z.number().int().nonnegative(),
  completedScheduledWarmupSetCount: z.number().int().nonnegative(),
  scheduledNames: z.array(z.string()),
  completedNames: z.array(z.string()),
  sources: z.array(z.string()),
});

export const trainingTimelineResponseSchema = z.object({
  today: calendarDaySchema,
  rangeStart: calendarDaySchema,
  rangeEnd: calendarDaySchema,
  activePlans: z.array(activeTrainingPlanSchema),
  items: z.array(trainingTimelineItemSchema),
  days: z.array(trainingDaySummarySchema),
});

export type TrainingTimelineItem = z.infer<typeof trainingTimelineItemSchema>;
export type ActiveTrainingPlan = z.infer<typeof activeTrainingPlanSchema>;
export type TrainingDaySummary = z.infer<typeof trainingDaySummarySchema>;
export type TrainingTimelineQuery = z.infer<typeof trainingTimelineQuerySchema>;
export type TrainingTimelineResponse = z.infer<
  typeof trainingTimelineResponseSchema
>;
