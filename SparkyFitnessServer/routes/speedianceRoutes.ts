import express from 'express';
import { z } from 'zod';
import {
  speedianceCreateAndScheduleWorkoutRequestSchema,
  speedianceCreateAndScheduleWorkoutResponseSchema,
  speedianceCreatePlanRequestSchema,
  speedianceCreatePlanResponseSchema,
  speedianceExerciseSearchRequestSchema,
  speedianceExerciseSearchResponseSchema,
  speedianceSyncRequestSchema,
  speedianceSyncResponseSchema,
  speedianceStatusResponseSchema,
  speedianceWorkoutDefinitionSchema,
  speedianceWorkoutDeleteRequestSchema,
  speedianceWorkoutDeleteResponseSchema,
  speedianceWorkoutDetailSchema,
  speedianceWorkoutListResponseSchema,
  speedianceWorkoutScheduleRequestSchema,
  speedianceWorkoutScheduleResponseSchema,
  speedianceWorkoutUpsertResponseSchema,
} from '@workspace/shared';
import authMiddleware from '../middleware/authMiddleware.js';
import { log } from '../config/logging.js';
import speedianceService from '../integrations/speediance/speedianceService.js';
import {
  SpeedianceApiError,
  SpeedianceAuthenticationError,
} from '../integrations/speediance/speedianceApiClient.js';
import speedianceWorkoutService, {
  SpeedianceWorkoutConflictError,
  SpeedianceWorkoutValidationError,
} from '../integrations/speediance/speedianceWorkoutService.js';

const router = express.Router();
const statusQuerySchema = z.object({
  providerId: z.string().uuid().optional(),
});

function isOwnerContext(userId: string, authenticatedUserId?: string): boolean {
  return !authenticatedUserId || userId === authenticatedUserId;
}

function ownerOnlyResponse(res: express.Response): express.Response {
  return res.status(403).json({
    message:
      'Speediance credentials and writes are available to the owner only.',
  });
}

function speedianceErrorResponse(
  res: express.Response,
  error: unknown,
  operation: string
): express.Response {
  const message = error instanceof Error ? error.message : String(error);
  log('error', `[speedianceRoutes] ${operation} failed: ${message}`);
  if (error instanceof SpeedianceWorkoutValidationError) {
    return res.status(400).json({ message });
  }
  if (error instanceof SpeedianceWorkoutConflictError) {
    return res.status(409).json({ message });
  }
  if (error instanceof SpeedianceAuthenticationError) {
    return res.status(401).json({ message });
  }
  if (error instanceof SpeedianceApiError) {
    return res.status(502).json({ message });
  }
  return res.status(500).json({ message: `Speediance ${operation} failed.` });
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
 * /integrations/speediance/exercises/search:
 *   post:
 *     summary: Search the authenticated owner's Speediance exercise library
 *     tags: [External Integrations]
 */
router.post(
  '/exercises/search',
  authMiddleware.authenticate,
  async (req, res) => {
    if (!isOwnerContext(req.userId, req.authenticatedUserId)) {
      return ownerOnlyResponse(res);
    }
    const parsed = speedianceExerciseSearchRequestSchema.safeParse(
      req.body ?? {}
    );
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Invalid Speediance exercise search request.',
        issues: parsed.error.issues,
      });
    }
    try {
      const result = await speedianceWorkoutService.searchSpeedianceExercises(
        req.userId,
        parsed.data
      );
      return res
        .status(200)
        .json(speedianceExerciseSearchResponseSchema.parse(result));
    } catch (error) {
      return speedianceErrorResponse(res, error, 'exercise search');
    }
  }
);

/**
 * @swagger
 * /integrations/speediance/workouts/schedule:
 *   post:
 *     summary: Create or reuse and schedule a verified Speediance workout
 *     tags: [External Integrations]
 */
router.post(
  '/workouts/schedule',
  authMiddleware.authenticate,
  async (req, res) => {
    if (!isOwnerContext(req.userId, req.authenticatedUserId)) {
      return ownerOnlyResponse(res);
    }
    const parsed = speedianceCreateAndScheduleWorkoutRequestSchema.safeParse(
      req.body ?? {}
    );
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Invalid Speediance workout request.',
        issues: parsed.error.issues,
      });
    }
    try {
      const result =
        await speedianceWorkoutService.createAndScheduleSpeedianceWorkout(
          req.userId,
          parsed.data
        );
      return res
        .status(200)
        .json(speedianceCreateAndScheduleWorkoutResponseSchema.parse(result));
    } catch (error) {
      return speedianceErrorResponse(res, error, 'workout scheduling');
    }
  }
);

/**
 * @swagger
 * /integrations/speediance/workouts:
 *   get:
 *     summary: List the owner's custom Speediance workouts
 *     tags: [External Integrations]
 *   post:
 *     summary: Create or update a Speediance workout and its native Sparky preset
 *     tags: [External Integrations]
 */
router.get('/workouts', authMiddleware.authenticate, async (req, res) => {
  if (!isOwnerContext(req.userId, req.authenticatedUserId)) {
    return ownerOnlyResponse(res);
  }
  const parsed = statusQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid providerId.' });
  }
  try {
    const result = await speedianceWorkoutService.listSpeedianceWorkouts(
      req.userId,
      parsed.data.providerId
    );
    return res
      .status(200)
      .json(speedianceWorkoutListResponseSchema.parse(result));
  } catch (error) {
    return speedianceErrorResponse(res, error, 'workout listing');
  }
});

router.post('/workouts', authMiddleware.authenticate, async (req, res) => {
  if (!isOwnerContext(req.userId, req.authenticatedUserId)) {
    return ownerOnlyResponse(res);
  }
  const parsed = speedianceWorkoutDefinitionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid Speediance workout definition.',
      issues: parsed.error.issues,
    });
  }
  try {
    const result = await speedianceWorkoutService.upsertSpeedianceWorkout(
      req.userId,
      parsed.data
    );
    return res
      .status(200)
      .json(speedianceWorkoutUpsertResponseSchema.parse(result));
  } catch (error) {
    return speedianceErrorResponse(res, error, 'workout synchronization');
  }
});

router.delete(
  '/workouts/:id',
  authMiddleware.authenticate,
  async (req, res) => {
    if (!isOwnerContext(req.userId, req.authenticatedUserId)) {
      return ownerOnlyResponse(res);
    }
    const parsed = speedianceWorkoutDeleteRequestSchema.safeParse(
      req.body ?? {}
    );
    if (!parsed.success || !req.params.id) {
      return res.status(400).json({
        message: 'Invalid Speediance workout deletion request.',
        issues: parsed.success ? [] : parsed.error.issues,
      });
    }
    try {
      const result = await speedianceWorkoutService.deleteSpeedianceWorkout(
        req.userId,
        req.params.id,
        parsed.data.remoteCode,
        parsed.data.confirmName,
        parsed.data.providerId
      );
      return res
        .status(200)
        .json(speedianceWorkoutDeleteResponseSchema.parse(result));
    } catch (error) {
      return speedianceErrorResponse(res, error, 'workout deletion');
    }
  }
);

router.get('/workouts/:code', authMiddleware.authenticate, async (req, res) => {
  if (!isOwnerContext(req.userId, req.authenticatedUserId)) {
    return ownerOnlyResponse(res);
  }
  const parsed = statusQuerySchema.safeParse(req.query);
  if (!parsed.success || !req.params.code) {
    return res.status(400).json({ message: 'Invalid Speediance workout.' });
  }
  try {
    const result = await speedianceWorkoutService.getSpeedianceWorkout(
      req.userId,
      req.params.code,
      parsed.data.providerId
    );
    return res.status(200).json(speedianceWorkoutDetailSchema.parse(result));
  } catch (error) {
    return speedianceErrorResponse(res, error, 'workout loading');
  }
});

router.post(
  '/workouts/:code/reservation',
  authMiddleware.authenticate,
  async (req, res) => {
    if (!isOwnerContext(req.userId, req.authenticatedUserId)) {
      return ownerOnlyResponse(res);
    }
    const parsed = speedianceWorkoutScheduleRequestSchema
      .extend({ scheduled: z.boolean() })
      .safeParse(req.body ?? {});
    if (!parsed.success || !req.params.code) {
      return res.status(400).json({
        message: 'Invalid Speediance workout reservation.',
        issues: parsed.success ? [] : parsed.error.issues,
      });
    }
    try {
      const result =
        await speedianceWorkoutService.setSpeedianceWorkoutSchedule(
          req.userId,
          req.params.code,
          parsed.data.date,
          parsed.data.scheduled,
          parsed.data.providerId
        );
      return res
        .status(200)
        .json(speedianceWorkoutScheduleResponseSchema.parse(result));
    } catch (error) {
      return speedianceErrorResponse(res, error, 'workout reservation');
    }
  }
);

router.post('/plans', authMiddleware.authenticate, async (req, res) => {
  if (!isOwnerContext(req.userId, req.authenticatedUserId)) {
    return ownerOnlyResponse(res);
  }
  const parsed = speedianceCreatePlanRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid Speediance training plan.',
      issues: parsed.error.issues,
    });
  }
  try {
    const result = await speedianceWorkoutService.createSpeediancePlan(
      req.userId,
      parsed.data
    );
    return res
      .status(200)
      .json(speedianceCreatePlanResponseSchema.parse(result));
  } catch (error) {
    return speedianceErrorResponse(res, error, 'training plan creation');
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
