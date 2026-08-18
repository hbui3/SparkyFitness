import { z } from "zod";

export const coachTelegramConnectionsIdSchema = z.string().and(
  z.object({
    __brand: z.literal("public.coach_telegram_connections"),
  }),
);

export const coachTelegramConnectionsSchema = z.object({
  id: coachTelegramConnectionsIdSchema,
  user_id: z.string(),
  telegram_chat_id: z.string().nullable(),
  telegram_user_id: z.string().nullable(),
  telegram_username: z.string().nullable(),
  enabled: z.boolean(),
  link_token_hash: z.string().nullable(),
  link_token_expires_at: z.date().nullable(),
  last_telegram_update_id: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

export type CoachTelegramConnections = z.infer<
  typeof coachTelegramConnectionsSchema
>;
