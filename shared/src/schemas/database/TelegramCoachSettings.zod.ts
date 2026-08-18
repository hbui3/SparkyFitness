import { z } from "zod";

export const telegramCoachSettingsSchema = z.object({
  id: z.literal(1),
  encrypted_bot_token: z.string().nullable(),
  bot_token_iv: z.string().nullable(),
  bot_token_tag: z.string().nullable(),
  encrypted_webhook_secret: z.string().nullable(),
  webhook_secret_iv: z.string().nullable(),
  webhook_secret_tag: z.string().nullable(),
  updated_at: z.date(),
});

export type TelegramCoachSettings = z.infer<typeof telegramCoachSettingsSchema>;
