import express, { RequestHandler, Response } from 'express';
import { z } from 'zod';
import {
  updateWorkoutSessionFeedbackRequestSchema,
  workoutCoachingSettingsSchema,
  workoutCoachingSignalsQuerySchema,
  workoutCoachingSignalsResponseSchema,
  workoutSessionFeedbackResponseSchema,
} from '@workspace/shared';
import { authenticate } from '../../middleware/authMiddleware.js';
import checkPermissionMiddleware from '../../middleware/checkPermissionMiddleware.js';
import requireSelfActor from '../../middleware/requireSelfMiddleware.js';
import {
  WorkoutFeedbackValidationError,
  WorkoutSessionNotFoundError,
  getWorkoutCoachingSettings,
  getWorkoutSessionFeedback,
  updateWorkoutCoachingSettings,
  updateWorkoutSessionFeedback,
} from '../../services/workoutCoachingService.js';
import { getWorkoutCoachingSignals } from '../../services/adaptiveWorkoutService.js';

const router = express.Router();

router.use(authenticate);

const presetEntryParamsSchema = z.object({ presetEntryId: z.string().uuid() });

function sendKnownError(res: Response, error: unknown): boolean {
  if (error instanceof WorkoutSessionNotFoundError) {
    res.status(404).json({ error: error.message });
    return true;
  }
  if (error instanceof WorkoutFeedbackValidationError) {
    res.status(400).json({ error: error.message });
    return true;
  }
  return false;
}

/**
 * @swagger
 * /v2/workout-coaching/settings:
 *   get:
 *     summary: Adaptive workout suggestion settings
 *     tags: [Exercise & Workouts]
 *     description: Whether workout suggestions adapt to session feedback. Defaults to true.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: '{ adaptive_suggestions: boolean }'
 *       401:
 *         description: Unauthenticated.
 *   put:
 *     summary: Turn adaptive workout suggestions on or off
 *     tags: [Exercise & Workouts]
 *     description: Owner only; a delegate acting for someone else gets 403.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [adaptive_suggestions]
 *             properties:
 *               adaptive_suggestions:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: The saved settings.
 *       400:
 *         description: Invalid body.
 *       403:
 *         description: Acting on behalf of another user.
 */
const getSettingsHandler: RequestHandler = async (req, res, next) => {
  try {
    res
      .status(200)
      .json(
        await getWorkoutCoachingSettings(req.userId, req.authenticatedUserId)
      );
  } catch (error) {
    next(error);
  }
};

const putSettingsHandler: RequestHandler = async (req, res, next) => {
  const parsed = workoutCoachingSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid request body',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }
  try {
    res
      .status(200)
      .json(await updateWorkoutCoachingSettings(req.userId, parsed.data));
  } catch (error) {
    next(error);
  }
};

router.get('/settings', getSettingsHandler);
router.put('/settings', requireSelfActor, putSettingsHandler);

/**
 * @swagger
 * /v2/workout-coaching/sessions/{presetEntryId}/feedback:
 *   get:
 *     summary: Feedback for a logged workout session
 *     tags: [Exercise & Workouts]
 *     description: |
 *       The session rating (too_easy | just_right | too_hard, plus a pain flag and note) and any per-exercise
 *       feedback. Readable like the diary (owner, can_manage_diary and can_view_reports delegates); writing
 *       requires can_manage_diary.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: presetEntryId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Session feedback (session is null when none was given).
 *       400:
 *         description: Invalid presetEntryId.
 *       404:
 *         description: Session not found or not visible.
 *   put:
 *     summary: Replace the feedback for a logged workout session
 *     tags: [Exercise & Workouts]
 *     description: |
 *       Replaces all of the session's feedback. `session: null` clears the session rating; exercises of the session
 *       left out of `exercises` have theirs cleared. Feedback with no difficulty and no pain is treated as none.
 *       A pain_note requires pain = true (max 500 characters).
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: presetEntryId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [session]
 *             properties:
 *               session:
 *                 nullable: true
 *                 type: object
 *                 properties:
 *                   difficulty:
 *                     type: string
 *                     nullable: true
 *                     enum: [too_easy, just_right, too_hard]
 *                   pain:
 *                     type: boolean
 *                   pain_note:
 *                     type: string
 *                     nullable: true
 *               exercises:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [exercise_entry_id, difficulty, pain]
 *                   properties:
 *                     exercise_entry_id:
 *                       type: string
 *                       format: uuid
 *                     difficulty:
 *                       type: string
 *                       nullable: true
 *                       enum: [too_easy, just_right, too_hard]
 *                     pain:
 *                       type: boolean
 *                     pain_note:
 *                       type: string
 *                       nullable: true
 *     responses:
 *       200:
 *         description: The saved session feedback.
 *       400:
 *         description: Invalid body, or an exercise entry that is not part of the session.
 *       403:
 *         description: No diary-management permission for this user.
 *       404:
 *         description: Session not found or not visible.
 */
const getFeedbackHandler: RequestHandler = async (req, res, next) => {
  const params = presetEntryParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Invalid presetEntryId' });
    return;
  }
  try {
    const feedback = await getWorkoutSessionFeedback(
      req.userId,
      req.authenticatedUserId,
      params.data.presetEntryId
    );
    res.status(200).json(workoutSessionFeedbackResponseSchema.parse(feedback));
  } catch (error) {
    if (!sendKnownError(res, error)) next(error);
  }
};

const putFeedbackHandler: RequestHandler = async (req, res, next) => {
  const params = presetEntryParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Invalid presetEntryId' });
    return;
  }
  const body = updateWorkoutSessionFeedbackRequestSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({
      error: 'Invalid request body',
      details: body.error.flatten().fieldErrors,
    });
    return;
  }
  try {
    const feedback = await updateWorkoutSessionFeedback(
      req.userId,
      req.authenticatedUserId,
      params.data.presetEntryId,
      body.data
    );
    res.status(200).json(workoutSessionFeedbackResponseSchema.parse(feedback));
  } catch (error) {
    if (!sendKnownError(res, error)) next(error);
  }
};

router.get(
  '/sessions/:presetEntryId/feedback',
  checkPermissionMiddleware('diary'),
  getFeedbackHandler
);
router.put(
  '/sessions/:presetEntryId/feedback',
  checkPermissionMiddleware('diary'),
  putFeedbackHandler
);

/**
 * @swagger
 * /v2/workout-coaching/signals:
 *   get:
 *     summary: Recent-history signals for adaptive workout suggestions
 *     tags: [Exercise & Workouts]
 *     description: |
 *       For each exercise the user has done in the last few weeks: the latest difficulty feedback, whether pain
 *       was reported (in the exercise or unspecified in the session), consecutive too-easy / too-hard / pain
 *       streaks, logged working-set RPE/RIR averages, and how many days it was done in the variation window.
 *       Clients turn these into adjustments with the shared adaptive rules. When the user has turned adaptive
 *       suggestions off, `adaptive_suggestions` is false and `signals` is empty.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: exerciseIds
 *         required: true
 *         schema:
 *           type: string
 *         description: Comma-separated exercise UUIDs (max 100).
 *       - in: query
 *         name: excludePresetEntryId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The workout in progress, so it doesn't count as the last session.
 *     responses:
 *       200:
 *         description: Signals for the exercises that have recent history.
 *       400:
 *         description: Invalid query parameters.
 *       403:
 *         description: No diary permission for this user.
 */
const getSignalsHandler: RequestHandler = async (req, res, next) => {
  const query = workoutCoachingSignalsQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({
      error: 'Invalid query parameters',
      details: query.error.flatten().fieldErrors,
    });
    return;
  }
  try {
    const signals = await getWorkoutCoachingSignals(
      req.userId,
      req.authenticatedUserId,
      query.data.exerciseIds,
      query.data.excludePresetEntryId ?? null
    );
    res.status(200).json(workoutCoachingSignalsResponseSchema.parse(signals));
  } catch (error) {
    next(error);
  }
};

router.get('/signals', checkPermissionMiddleware('diary'), getSignalsHandler);

export default router;
