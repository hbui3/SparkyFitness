import { z } from 'zod';

export const cnfBulkImportRequestSchema = z.object({
  archiveUrl: z
    .string()
    .url()
    .refine((url) => url.startsWith('https://'), {
      message: 'archiveUrl must be an HTTPS URL',
    })
    .optional(),
  syncPastEntries: z.boolean().optional().default(false),
  language: z.enum(['en', 'fr']).optional().default('en'),
  maxFoods: z.number().int().positive().optional(),
});

export type CnfBulkImportRequest = z.infer<typeof cnfBulkImportRequestSchema>;

export const cnfBulkImportStatusSchema = z.object({
  userId: z.string(),
  isRunning: z.boolean(),
  status: z.enum(['idle', 'running', 'completed', 'failed']),
  progress: z.number(),
  total: z.number(),
  processed: z.number(),
  imported: z.number(),
  updated: z.number(),
  error: z.string().optional(),
  lastRunAt: z.string().optional(),
});

export type CnfBulkImportStatus = z.infer<typeof cnfBulkImportStatusSchema>;

export const cnfDeleteLibraryResponseSchema = z.object({
  message: z.string(),
  deletedCount: z.number(),
});

export type CnfDeleteLibraryResponse = z.infer<
  typeof cnfDeleteLibraryResponseSchema
>;
