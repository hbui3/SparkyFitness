import express from 'express';
import { z } from 'zod';
import {
  speedianceSyncRequestSchema,
  speedianceSyncResponseSchema,
  speedianceStatusResponseSchema,
} from '@workspace/shared';
import authMiddleware from '../middleware/authMiddleware.js';
import { log } from '../config/logging.js';
import speedianceService from '../integrations/speediance/speedianceService.js';
import {
  SpeedianceApiError,
  SpeedianceAuthenticationError,
} from '../integrations/speediance/speedianceApiClient.js';

const router = express.Router();
const statusQuerySchema = z.object({
  providerId: z.string().uuid().optional(),
});

function isOwnerContext(userId: string, authenticatedUserId?: string): boolean {
  return !authenticatedUserId || userId === authenticatedUserId;
}

/**
 * @swagger
 * /integrations/speediance/sync:
 *   post:
 *     summary: Import Speediance workouts for the authenticated owner
 *     tags: [External Integrations]
 */
router.post('/sync', authMiddleware.authenticate, async (req, res) => {
  if (!isOwnerContext(req.userId, req.authenticatedUserId)) {
    return res.status(403).json({
      message:
        'Speediance credentials and sync are available to the owner only.',
    });
  }
  const parsed = speedianceSyncRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid Speediance sync request.',
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await speedianceService.syncSpeedianceData(
      req.userId,
      req.authenticatedUserId ?? req.userId,
      parsed.data
    );
    return res.status(200).json(speedianceSyncResponseSchema.parse(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `[speedianceRoutes] Manual sync failed: ${message}`);
    if (error instanceof SpeedianceAuthenticationError) {
      return res.status(401).json({ message });
    }
    if (error instanceof SpeedianceApiError) {
      return res.status(502).json({ message });
    }
    return res.status(500).json({ message: 'Speediance sync failed.' });
  }
});

/**
 * @swagger
 * /integrations/speediance/status:
 *   get:
 *     summary: Get Speediance provider connection status
 *     tags: [External Integrations]
 */
router.get('/status', authMiddleware.authenticate, async (req, res) => {
  if (!isOwnerContext(req.userId, req.authenticatedUserId)) {
    return res.status(403).json({
      message:
        'Speediance credentials and status are available to the owner only.',
    });
  }
  const parsed = statusQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid providerId.' });
  }
  try {
    const status = await speedianceService.getSpeedianceStatus(
      req.userId,
      parsed.data.providerId
    );
    return res.status(200).json(speedianceStatusResponseSchema.parse(status));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `[speedianceRoutes] Status lookup failed: ${message}`);
    return res
      .status(500)
      .json({ message: 'Unable to read Speediance status.' });
  }
});

export default router;
