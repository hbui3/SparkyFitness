import { z } from "zod";

export const coachActionReceiptStatusSchema = z.enum([
  "completed",
  "undone",
  "expired",
]);

export const coachActionReceiptsSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  action_type: z.string(),
  resource_type: z.string(),
  resource_id: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  status: coachActionReceiptStatusSchema,
  expires_at: z.coerce.date(),
  undone_at: z.coerce.date().nullable(),
  created_at: z.coerce.date(),
});

export type CoachActionReceipt = z.infer<typeof coachActionReceiptsSchema>;
