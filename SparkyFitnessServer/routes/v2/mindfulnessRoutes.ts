import express from 'express';
import {
  createMindfulnessSessionBodySchema,
  updateMindfulnessSessionBodySchema,
} from '@workspace/shared';
import { authenticate } from '../../middleware/authMiddleware.js';
import onBehalfOfMiddleware from '../../middleware/onBehalfOfMiddleware.js';
import checkPermissionMiddleware from '../../middleware/checkPermissionMiddleware.js';
import {
  createMindfulnessSession,
  getMindfulnessSessionsByDate,
  getMindfulnessSessionsRange,
  getMindfulnessSessionById,
  updateMindfulnessSession,
  deleteMindfulnessSession,
  getMindfulnessDaySummary,
} from '../../models/mindfulnessRepository.js';

const router = express.Router();

router.use(authenticate);
router.use(onBehalfOfMiddleware);
router.use(checkPermissionMiddleware('checkin'));

// GET /api/v2/mindfulness/day-summary?date=YYYY-MM-DD
router.get('/day-summary', async (req, res, next) => {
  try {
    const targetUserId = req.userId;
    const authenticatedUserId = req.authenticatedUserId || req.userId;
    const date = String(req.query.date || '');

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res
        .status(400)
        .json({ error: 'date query parameter must be YYYY-MM-DD' });
    }

    const summary = await getMindfulnessDaySummary(
      targetUserId,
      date,
      authenticatedUserId
    );
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/mindfulness/entries?date=YYYY-MM-DD OR ?startDate=...&endDate=...
router.get('/entries', async (req, res, next) => {
  try {
    const targetUserId = req.userId;
    const authenticatedUserId = req.authenticatedUserId || req.userId;
    const date = req.query.date ? String(req.query.date) : null;
    const startDate = req.query.startDate ? String(req.query.startDate) : null;
    const endDate = req.query.endDate ? String(req.query.endDate) : null;

    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      }
      const sessions = await getMindfulnessSessionsByDate(
        targetUserId,
        date,
        authenticatedUserId
      );
      return res.json(sessions);
    }

    if (startDate && endDate) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
      ) {
        return res
          .status(400)
          .json({ error: 'startDate and endDate must be YYYY-MM-DD' });
      }
      const sessions = await getMindfulnessSessionsRange(
        targetUserId,
        startDate,
        endDate,
        authenticatedUserId
      );
      return res.json(sessions);
    }

    return res
      .status(400)
      .json({ error: 'Either date or startDate and endDate are required' });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/mindfulness/entries/:id
router.get('/entries/:id', async (req, res, next) => {
  try {
    const targetUserId = req.userId;
    const authenticatedUserId = req.authenticatedUserId || req.userId;
    const session = await getMindfulnessSessionById(
      targetUserId,
      req.params.id,
      authenticatedUserId
    );

    if (!session) {
      return res.status(404).json({ error: 'Mindfulness session not found' });
    }

    res.json(session);
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/mindfulness/entries
router.post('/entries', async (req, res, next) => {
  try {
    const targetUserId = req.userId;
    const authenticatedUserId = req.authenticatedUserId || req.userId;

    const parseResult = createMindfulnessSessionBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: parseResult.error.format(),
      });
    }

    const created = await createMindfulnessSession(
      targetUserId,
      parseResult.data,
      authenticatedUserId
    );

    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

// PUT /api/v2/mindfulness/entries/:id
router.put('/entries/:id', async (req, res, next) => {
  try {
    const targetUserId = req.userId;
    const authenticatedUserId = req.authenticatedUserId || req.userId;

    const parseResult = updateMindfulnessSessionBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: parseResult.error.format(),
      });
    }

    const updated = await updateMindfulnessSession(
      targetUserId,
      req.params.id,
      parseResult.data,
      authenticatedUserId
    );

    if (!updated) {
      return res.status(404).json({ error: 'Mindfulness session not found' });
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v2/mindfulness/entries/:id
router.delete('/entries/:id', async (req, res, next) => {
  try {
    const targetUserId = req.userId;
    const authenticatedUserId = req.authenticatedUserId || req.userId;

    const deleted = await deleteMindfulnessSession(
      targetUserId,
      req.params.id,
      authenticatedUserId
    );

    if (!deleted) {
      return res.status(404).json({ error: 'Mindfulness session not found' });
    }

    res.json({
      success: true,
      message: 'Mindfulness session deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
