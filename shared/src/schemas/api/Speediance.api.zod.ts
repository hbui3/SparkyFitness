import { z } from "zod";

export const speedianceRegionSchema = z.enum(["EU", "Global"]);

const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD calendar day");

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
