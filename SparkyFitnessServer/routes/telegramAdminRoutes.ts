import express from 'express';
import { updateTelegramAdminConfigRequestSchema } from '@workspace/shared';
import { isAdmin } from '../middleware/authMiddleware.js';
import telegramAdminService from '../services/telegramAdminService.js';

const router = express.Router();

router.get('/', isAdmin, async (_req, res, next) => {
  try {
    res.json(await telegramAdminService.getStatus());
  } catch (error) {
    next(error);
  }
});

router.put('/', isAdmin, async (req, res, next) => {
  try {
    const parsed = updateTelegramAdminConfigRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: 'Invalid Telegram bot configuration.',
        errors: parsed.error.flatten(),
      });
      return;
    }
    res.json(await telegramAdminService.updateBotToken(parsed.data.botToken));
  } catch (error) {
    next(error);
  }
});

router.delete('/', isAdmin, async (_req, res, next) => {
  try {
    res.json(await telegramAdminService.removeBotToken());
  } catch (error) {
    next(error);
  }
});

export default router;
