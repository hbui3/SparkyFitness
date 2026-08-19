import { z } from "zod";

export const telegramUpdateInboxStatusSchema = z.enum([
  "pending",
  "processing",
  "processed",
  "dead_letter",
]);

export const telegramUpdateInboxSchema = z.object({
  update_id: z.string(),
  payload: z.record(z.string(), z.unknown()),
  status: telegramUpdateInboxStatusSchema,
  attempt_count: z.number().int().nonnegative(),
  available_at: z.coerce.date(),
  locked_at: z.coerce.date().nullable(),
  processed_at: z.coerce.date().nullable(),
  last_error: z.string().nullable(),
  created_at: z.coerce.date(),
});

export type TelegramUpdateInbox = z.infer<typeof telegramUpdateInboxSchema>;
