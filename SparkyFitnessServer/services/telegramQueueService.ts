import { randomUUID } from 'node:crypto';
import telegramQueueRepository, {
  type TelegramButton,
} from '../models/telegramQueueRepository.js';
import coachTelegramRepository from '../models/coachTelegramRepository.js';
import {
  isTelegramConfigured,
  sendTelegramMessage,
} from './telegramApiService.js';
import { log } from '../config/logging.js';
import type { TelegramUpdate } from './telegramCoachService.js';

type TelegramUpdateHandler = (update: TelegramUpdate) => Promise<void>;

let workerTimer: ReturnType<typeof setInterval> | null = null;
let processing = false;
let lastCleanupAt = 0;

function errorCode(error: unknown): string {
  if (error instanceof Error) {
    return error.name === 'Error' ? 'telegram_processing_error' : error.name;
  }
  return 'telegram_processing_error';
}

export async function queueTelegramDelivery(input: {
  userId: string;
  content: string;
  telegramChatId?: string | null;
  buttons?: TelegramButton[][];
  idempotencyKey?: string;
}): Promise<string | null> {
  return telegramQueueRepository.enqueueDelivery({
    ...input,
    idempotencyKey: input.idempotencyKey ?? `chat:${randomUUID()}`,
  });
}

async function processOneUpdate(
  handler: TelegramUpdateHandler
): Promise<boolean> {
  const item = await telegramQueueRepository.claimNextUpdate();
  if (!item) return false;
  try {
    await handler(item.payload);
    await telegramQueueRepository.completeUpdate(item.updateId);
  } catch (error) {
    log(
      'error',
      `Telegram inbox update ${item.updateId} failed on attempt ${item.attemptCount}.`
    );
    await telegramQueueRepository.retryUpdate(
      item.updateId,
      item.attemptCount,
      errorCode(error)
    );
  }
  return true;
}

async function processOneDelivery(): Promise<boolean> {
  const item = await telegramQueueRepository.claimNextDelivery();
  if (!item) return false;
  try {
    if (!(await isTelegramConfigured())) {
      await telegramQueueRepository.retryDelivery(
        item.id,
        item.attemptCount,
        'telegram_not_configured'
      );
      return true;
    }
    const telegramChatId =
      item.telegramChatId ??
      (await coachTelegramRepository.getConnectedChatId(item.userId));
    if (!telegramChatId) {
      await telegramQueueRepository.skipDelivery(
        item.id,
        'telegram_connection_unavailable'
      );
      return true;
    }
    await sendTelegramMessage(telegramChatId, item.content, item.buttons);
    await telegramQueueRepository.completeDelivery(item.id);
  } catch (error) {
    log(
      'error',
      `Telegram outbox delivery ${item.id} failed on attempt ${item.attemptCount}.`
    );
    await telegramQueueRepository.retryDelivery(
      item.id,
      item.attemptCount,
      errorCode(error)
    );
  }
  return true;
}

export async function processTelegramQueues(
  handler: TelegramUpdateHandler
): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    if (Date.now() - lastCleanupAt > 60 * 60_000) {
      lastCleanupAt = Date.now();
      await telegramQueueRepository
        .cleanupQueues()
        .catch((error) =>
          log('warn', 'Telegram queue retention cleanup failed:', error)
        );
    }
    for (let count = 0; count < 20; count += 1) {
      const [hadUpdate, hadDelivery] = await Promise.all([
        processOneUpdate(handler),
        processOneDelivery(),
      ]);
      if (!hadUpdate && !hadDelivery) break;
    }
  } finally {
    processing = false;
  }
}

export function startTelegramQueueWorker(handler: TelegramUpdateHandler): void {
  if (workerTimer) return;
  const run = (): void => {
    void processTelegramQueues(handler).catch((error) =>
      log('error', 'Telegram queue worker failed:', error)
    );
  };
  workerTimer = setInterval(run, 1_000);
  workerTimer.unref();
  run();
}

export function stopTelegramQueueWorker(): void {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
}

export default {
  queueTelegramDelivery,
  processTelegramQueues,
  startTelegramQueueWorker,
  stopTelegramQueueWorker,
};
