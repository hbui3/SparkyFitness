import { z } from "zod";

export const coachDeliveryStatusSchema = z.enum([
  "pending",
  "processing",
  "delivered",
  "failed",
  "skipped",
]);

export const coachDeliveryOutboxSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  channel: z.literal("telegram"),
  telegram_chat_id: z.string().nullable(),
  content: z.string(),
  buttons: z.array(z.array(z.record(z.string(), z.string()))),
  idempotency_key: z.string(),
  status: coachDeliveryStatusSchema,
  attempt_count: z.number().int().nonnegative(),
  available_at: z.coerce.date(),
  locked_at: z.coerce.date().nullable(),
  delivered_at: z.coerce.date().nullable(),
  last_error: z.string().nullable(),
  created_at: z.coerce.date(),
});

export type CoachDeliveryOutbox = z.infer<typeof coachDeliveryOutboxSchema>;
