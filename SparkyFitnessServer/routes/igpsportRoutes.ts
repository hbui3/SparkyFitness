import express from 'express';
import { z } from 'zod';
import {
  igpsportStatusResponseSchema,
  igpsportSyncRequestSchema,
  igpsportSyncResponseSchema,
} from '@workspace/shared';
import { log } from '../config/logging.js';
import igpsportService from '../integrations/igpsport/igpsportService.js';
import {
  IGPSportApiError,
  IGPSportAuthenticationError,
} from '../integrations/igpsport/igpsportApiClient.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();
const statusQuerySchema = z.object({
  providerId: z.string().uuid().optional(),
});

function isOwnerContext(userId: string, authenticatedUserId?: string): boolean {
  return !authenticatedUserId || userId === authenticatedUserId;
}

/**
 * @swagger
 * /integrations/igpsport/sync:
 *   post:
 *     summary: Import iGPSPORT FIT activities for the authenticated owner
 *     tags: [External Integrations]
 */
router.post('/sync', authMiddleware.authenticate, async (req, res) => {
  if (!isOwnerContext(req.userId, req.authenticatedUserId)) {
    return res.status(403).json({
      message: 'iGPSPORT credentials and sync are available to the owner only.',
    });
  }
  const parsed = igpsportSyncRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid iGPSPORT sync request.',
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await igpsportService.syncIGPSportData(
      req.userId,
      req.authenticatedUserId ?? req.userId,
      parsed.data
    );
    return res.status(200).json(igpsportSyncResponseSchema.parse(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `[igpsportRoutes] Manual sync failed: ${message}`);
    if (error instanceof IGPSportAuthenticationError) {
      return res.status(401).json({ message });
    }
    if (error instanceof IGPSportApiError) {
      return res.status(502).json({ message });
    }
    return res.status(500).json({ message: 'iGPSPORT sync failed.' });
  }
});

/**
 * @swagger
 * /integrations/igpsport/status:
 *   get:
 *     summary: Get iGPSPORT provider connection status
 *     tags: [External Integrations]
 */
router.get('/status', authMiddleware.authenticate, async (req, res) => {
  if (!isOwnerContext(req.userId, req.authenticatedUserId)) {
    return res.status(403).json({
      message:
        'iGPSPORT credentials and status are available to the owner only.',
    });
  }
  const parsed = statusQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid providerId.' });
  }
  try {
    const status = await igpsportService.getIGPSportStatus(
      req.userId,
      parsed.data.providerId
    );
    return res.status(200).json(igpsportStatusResponseSchema.parse(status));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `[igpsportRoutes] Status lookup failed: ${message}`);
    return res.status(500).json({ message: 'Unable to read iGPSPORT status.' });
  }
});

export default router;
