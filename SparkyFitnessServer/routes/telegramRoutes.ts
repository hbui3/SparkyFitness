import { timingSafeEqual } from 'crypto';
import express from 'express';
import telegramCoachService, {
  type TelegramUpdate,
} from '../services/telegramCoachService.js';
import { getTelegramWebhookSecret } from '../services/telegramApiService.js';
import { log } from '../config/logging.js';

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

  res.sendStatus(200);
  void telegramCoachService
    .handleTelegramUpdate(req.body as TelegramUpdate)
    .catch((error) => {
      log('error', 'Telegram webhook processing failed:', error);
    });
});

export default router;
