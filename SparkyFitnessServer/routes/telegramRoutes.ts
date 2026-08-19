import { timingSafeEqual } from 'crypto';
import express from 'express';
import type { TelegramUpdate } from '../services/telegramCoachService.js';
import { getTelegramWebhookSecret } from '../services/telegramApiService.js';
import telegramQueueRepository from '../models/telegramQueueRepository.js';

const router = express.Router();

function secretsMatch(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

router.post('/webhook', async (req, res) => {
  const expectedSecret = await getTelegramWebhookSecret();
  const actualSecret = req.header('x-telegram-bot-api-secret-token');
  if (!expectedSecret || !secretsMatch(actualSecret, expectedSecret)) {
    res.sendStatus(401);
    return;
  }

  const update = req.body as TelegramUpdate;
  if (!Number.isSafeInteger(update.update_id)) {
    res.status(400).json({ error: 'Invalid Telegram update.' });
    return;
  }
  // Acknowledge Telegram only after the exact update has been persisted. A
  // duplicate insert is still a successful acknowledgement.
  await telegramQueueRepository.enqueueUpdate(update);
  res.sendStatus(200);
});

export default router;
