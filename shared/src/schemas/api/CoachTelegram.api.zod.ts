import { z } from "zod";

export const coachTelegramConnectionStatusSchema = z.object({
  available: z.boolean(),
  connected: z.boolean(),
  botUsername: z.string().nullable(),
  telegramUsername: z.string().nullable(),
});

export const coachTelegramLinkResponseSchema = z.object({
  url: z.string().url(),
  expiresAt: z.string().datetime(),
  botUsername: z.string(),
});

export const coachTelegramDisconnectResponseSchema = z.object({
  disconnected: z.boolean(),
});

export const telegramAdminConfigStatusSchema = z.object({
  configured: z.boolean(),
  source: z.enum(["database", "environment", "none"]),
  botUsername: z.string().nullable(),
  webhookUrl: z.string().nullable(),
  databaseTokenStored: z.boolean(),
});

export const updateTelegramAdminConfigRequestSchema = z.object({
  botToken: z.string().trim().min(20).max(256),
});

export type CoachTelegramConnectionStatus = z.infer<
  typeof coachTelegramConnectionStatusSchema
>;
export type CoachTelegramLinkResponse = z.infer<
  typeof coachTelegramLinkResponseSchema
>;
export type CoachTelegramDisconnectResponse = z.infer<
  typeof coachTelegramDisconnectResponseSchema
>;
export type TelegramAdminConfigStatus = z.infer<
  typeof telegramAdminConfigStatusSchema
>;
export type UpdateTelegramAdminConfigRequest = z.infer<
  typeof updateTelegramAdminConfigRequestSchema
>;
