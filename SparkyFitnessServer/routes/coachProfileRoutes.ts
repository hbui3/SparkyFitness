import express from 'express';
import {
  createCoachMemoryRequestSchema,
  updateCoachProfileRequestSchema,
  updateCoachMemoryRequestSchema,
  validateMealSuggestionRequestSchema,
} from '@workspace/shared';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware.js';
import coachProfileService from '../services/coachProfileService.js';
import telegramCoachService from '../services/telegramCoachService.js';
import coachMemoryService from '../services/coachMemoryService.js';
import coachContextService from '../services/coachContextService.js';
import coachEventService from '../services/coachEventService.js';

const router = express.Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Coach Profile
 *   description: Private persistent preferences, constraints, and proactive schedules for the AI coach. Goal fields in responses are inherited from onboarding and active dated goals.
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
 *         description: Coach preferences/schedules plus inherited canonical goals, or defaults when no profile has been saved yet.
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
 *     summary: Replace the authenticated user's private coach preferences and proactive schedules
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

router.get('/today', async (req, res, next) => {
  try {
    res.json(
      await coachContextService.getCoachTodayStatus(
        req.authenticatedUserId,
        req.headers['accept-language'] ?? 'de'
      )
    );
  } catch (error) {
    next(error);
  }
});

router.get('/memories', async (req, res, next) => {
  try {
    res.json(await coachMemoryService.listMemories(req.authenticatedUserId));
  } catch (error) {
    next(error);
  }
});

router.post('/memories', async (req, res, next) => {
  try {
    const parsed = createCoachMemoryRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: 'Invalid coach memory',
        errors: parsed.error.flatten(),
      });
      return;
    }
    const memory = await coachMemoryService.createMemory(
      req.authenticatedUserId,
      parsed.data
    );
    coachEventService.publish(req.authenticatedUserId, 'coach');
    res.status(201).json(memory);
  } catch (error) {
    next(error);
  }
});

router.patch('/memories/:id', async (req, res, next) => {
  try {
    const id = z.string().uuid().safeParse(req.params.id);
    const body = updateCoachMemoryRequestSchema.safeParse(req.body);
    if (!id.success || !body.success) {
      res.status(400).json({ message: 'Invalid coach memory update.' });
      return;
    }
    const memory = await coachMemoryService.updateMemory(
      req.authenticatedUserId,
      id.data,
      body.data
    );
    if (!memory) {
      res.status(404).json({ message: 'Coach memory not found.' });
      return;
    }
    coachEventService.publish(req.authenticatedUserId, 'coach');
    res.json(memory);
  } catch (error) {
    next(error);
  }
});

router.delete('/memories/:id', async (req, res, next) => {
  try {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ message: 'Invalid coach memory id.' });
      return;
    }
    if (
      !(await coachMemoryService.deleteMemory(req.authenticatedUserId, id.data))
    ) {
      res.status(404).json({ message: 'Coach memory not found.' });
      return;
    }
    coachEventService.publish(req.authenticatedUserId, 'coach');
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get('/events', (req, res) => {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('event: ready\ndata: {}\n\n');
  const unsubscribe = coachEventService.subscribe(
    req.authenticatedUserId,
    (event) => {
      res.write(`id: ${event.id}\n`);
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  );
  const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

/**
 * @swagger
 * /coach-profile/telegram:
 *   get:
 *     summary: Get the authenticated user's private Telegram coach connection
 *     tags: [Coach Profile]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Telegram availability and connection state.
 */
router.get('/telegram', async (req, res, next) => {
  try {
    res.json(
      await telegramCoachService.getConnectionStatus(req.authenticatedUserId)
    );
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /coach-profile/telegram/link:
 *   post:
 *     summary: Create a short-lived Telegram bot pairing link
 *     tags: [Coach Profile]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: One-time t.me pairing link.
 *       503:
 *         description: Telegram is not configured by the server operator.
 */
router.post('/telegram/link', async (req, res, next) => {
  try {
    const status = await telegramCoachService.getConnectionStatus(
      req.authenticatedUserId
    );
    if (!status.available) {
      res.status(503).json({ message: 'Telegram coach is not configured.' });
      return;
    }
    res.json(await telegramCoachService.createLink(req.authenticatedUserId));
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /coach-profile/telegram:
 *   delete:
 *     summary: Disconnect Telegram from the authenticated user's coach
 *     tags: [Coach Profile]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Telegram connection removed.
 */
router.delete('/telegram', async (req, res, next) => {
  try {
    res.json(await telegramCoachService.disconnect(req.authenticatedUserId));
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
