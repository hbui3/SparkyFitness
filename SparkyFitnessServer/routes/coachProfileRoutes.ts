import express from 'express';
import {
  updateCoachProfileRequestSchema,
  validateMealSuggestionRequestSchema,
} from '@workspace/shared';
import { authenticate } from '../middleware/authMiddleware.js';
import coachProfileService from '../services/coachProfileService.js';

const router = express.Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Coach Profile
 *   description: Private persistent preferences and constraints for the AI coach.
 */

/**
 * @swagger
 * /coach-profile:
 *   get:
 *     summary: Get the authenticated user's private coach profile
 *     tags: [Coach Profile]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Coach profile or defaults when it has not been saved yet.
 *       401:
 *         description: Unauthorized.
 */
router.get('/', async (req, res, next) => {
  try {
    const profile = await coachProfileService.getCoachProfile(
      req.authenticatedUserId
    );
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /coach-profile:
 *   put:
 *     summary: Replace the authenticated user's private coach profile
 *     tags: [Coach Profile]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Saved coach profile.
 *       400:
 *         description: Invalid request body.
 *       401:
 *         description: Unauthorized.
 */
router.put('/', async (req, res, next) => {
  try {
    const parsed = updateCoachProfileRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: 'Invalid coach profile',
        errors: parsed.error.flatten(),
      });
      return;
    }
    const profile = await coachProfileService.updateCoachProfile(
      req.authenticatedUserId,
      parsed.data
    );
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /coach-profile/validate-meal:
 *   post:
 *     summary: Validate a proposed meal against private dietary constraints
 *     tags: [Coach Profile]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ingredients]
 *             properties:
 *               ingredients:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Deterministic validation result.
 *       400:
 *         description: Invalid request body.
 */
router.post('/validate-meal', async (req, res, next) => {
  try {
    const parsed = validateMealSuggestionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: 'Invalid ingredient list',
        errors: parsed.error.flatten(),
      });
      return;
    }
    const result = await coachProfileService.validateMealSuggestion(
      req.authenticatedUserId,
      parsed.data.ingredients
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
