import { z } from "zod";

export const igpsportRegionSchema = z.enum(["Global", "China"]);

const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD calendar day");

export const igpsportSyncRequestSchema = z
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

export const igpsportSyncResponseSchema = z.object({
  success: z.literal(true),
  createdActivities: z.number().int().nonnegative(),
  updatedActivities: z.number().int().nonnegative(),
  failedActivities: z.number().int().nonnegative(),
  startDate: calendarDaySchema,
  endDate: calendarDaySchema,
});

export const igpsportStatusResponseSchema = z.object({
  connected: z.boolean(),
  active: z.boolean(),
  region: igpsportRegionSchema.nullable(),
  lastSyncAt: z.string().datetime().nullable(),
});

export type IGPSportRegion = z.infer<typeof igpsportRegionSchema>;
export type IGPSportSyncRequest = z.infer<typeof igpsportSyncRequestSchema>;
export type IGPSportSyncResponse = z.infer<typeof igpsportSyncResponseSchema>;
export type IGPSportStatusResponse = z.infer<
  typeof igpsportStatusResponseSchema
>;
