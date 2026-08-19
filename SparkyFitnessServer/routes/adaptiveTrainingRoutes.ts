import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import {
  adaptiveTrainingDaySchema,
  regenerateAdaptiveTrainingRequestSchema,
  updateAdaptiveTrainingRecommendationStatusRequestSchema,
  updateAdaptiveTrainingSettingsRequestSchema,
} from '@workspace/shared';
import { authenticate } from '../middleware/authMiddleware.js';
import checkPermissionMiddleware from '../middleware/checkPermissionMiddleware.js';
import adaptiveTrainingService from '../services/adaptiveTrainingService.js';

const router = express.Router();
router.use(authenticate);
router.use(checkPermissionMiddleware('diary'));

function validationError(res: Response, details: unknown): Response {
  return res
    .status(400)
    .json({ error: 'Invalid adaptive training request.', details });
}

/**
 * @swagger
 * /adaptive-training/today:
 *   get:
 *     summary: Get the recovery-aware workout recommendation and muscle load
 *     tags: [Fitness & Workouts]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Adaptive training dashboard.
 */
router.get(
  '/today',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dateResult = adaptiveTrainingDaySchema
        .optional()
        .safeParse(req.query.date);
      if (!dateResult.success) {
        return validationError(res, dateResult.error.flatten());
      }
      const dashboard =
        await adaptiveTrainingService.getAdaptiveTrainingDashboard(
          req.userId,
          req.authenticatedUserId,
          dateResult.data,
          {
            persistRecommendation: req.userId === req.authenticatedUserId,
          }
        );
      return res.json(dashboard);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /adaptive-training/settings:
 *   put:
 *     summary: Update adaptive training settings and recalculate the day
 *     tags: [Fitness & Workouts]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Updated dashboard.
 */
router.put(
  '/settings',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bodyResult = updateAdaptiveTrainingSettingsRequestSchema.safeParse(
        req.body
      );
      const dateResult = adaptiveTrainingDaySchema
        .optional()
        .safeParse(req.query.date);
      if (!bodyResult.success || !dateResult.success) {
        return validationError(res, {
          body: bodyResult.success ? null : bodyResult.error.flatten(),
          query: dateResult.success ? null : dateResult.error.flatten(),
        });
      }
      const dashboard =
        await adaptiveTrainingService.updateAdaptiveTrainingSettings(
          req.userId,
          req.authenticatedUserId,
          bodyResult.data,
          dateResult.data
        );
      return res.json(dashboard);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('Workout preset ')
      ) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  }
);

/**
 * @swagger
 * /adaptive-training/regenerate:
 *   post:
 *     summary: Explicitly recalculate an adaptive workout recommendation
 *     tags: [Fitness & Workouts]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Recalculated dashboard.
 */
router.post(
  '/regenerate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bodyResult = regenerateAdaptiveTrainingRequestSchema.safeParse(
        req.body ?? {}
      );
      if (!bodyResult.success) {
        return validationError(res, bodyResult.error.flatten());
      }
      const dashboard =
        await adaptiveTrainingService.getAdaptiveTrainingDashboard(
          req.userId,
          req.authenticatedUserId,
          bodyResult.data.date,
          { forceRegenerate: true }
        );
      return res.json(dashboard);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /adaptive-training/recommendations/{date}/status:
 *   patch:
 *     summary: Update the status of a daily adaptive training recommendation
 *     tags: [Fitness & Workouts]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Updated recommendation.
 *       404:
 *         description: Recommendation not found.
 */
router.patch(
  '/recommendations/:date/status',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dateResult = adaptiveTrainingDaySchema.safeParse(req.params.date);
      const bodyResult =
        updateAdaptiveTrainingRecommendationStatusRequestSchema.safeParse(
          req.body
        );
      if (!dateResult.success || !bodyResult.success) {
        return validationError(res, {
          date: dateResult.success ? null : dateResult.error.flatten(),
          body: bodyResult.success ? null : bodyResult.error.flatten(),
        });
      }
      const recommendation =
        await adaptiveTrainingService.updateAdaptiveTrainingRecommendationStatus(
          req.userId,
          req.authenticatedUserId,
          dateResult.data,
          bodyResult.data.status
        );
      return res.json(recommendation);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Adaptive training recommendation not found.'
      ) {
        return res.status(404).json({ error: error.message });
      }
      next(error);
    }
  }
);

export default router;
