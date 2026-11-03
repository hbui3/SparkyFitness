import { randomUUID } from 'node:crypto';
import { dayOfWeek, instantHourMinute, todayInZone } from '@workspace/shared';
import telegramQueueRepository, {
  type TelegramButton,
  type TelegramOutboxWorkItem,
} from '../models/telegramQueueRepository.js';
import coachTelegramRepository from '../models/coachTelegramRepository.js';
import coachProfileRepository from '../models/coachProfileRepository.js';
import {
  isTelegramConfigured,
  sendTelegramMessage,
} from './telegramApiService.js';
import { log } from '../config/logging.js';
import type { TelegramUpdate } from './telegramCoachService.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';

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

async function proactiveDeliveryAllowed(
  item: TelegramOutboxWorkItem
): Promise<boolean> {
  const prefix = `proactive:${item.userId}:`;
  if (!item.idempotencyKey.startsWith(prefix)) return true;
  const [kind, deliveryDate] = item.idempotencyKey
    .slice(prefix.length)
    .split(':');
  const profile = await coachProfileRepository.getCoachProfile(item.userId);
  if (!profile?.enabled) return false;
  const scheduleEnabled =
    kind === 'adaptive'
      ? profile.adaptive_check_ins_enabled
      : kind === 'daily'
        ? profile.daily_check_in_enabled
        : kind === 'weekly'
          ? profile.weekly_review_enabled
          : kind === 'restock'
            ? profile.proactive_categories.includes('nutrition') &&
              (profile.adaptive_check_ins_enabled ||
                profile.daily_check_in_enabled)
            : false;
  if (!scheduleEnabled) return false;
  const timezone = await loadUserTimezone(item.userId);
  const today = todayInZone(timezone);
  if (deliveryDate?.slice(0, 10) !== today) return false;
  const local = instantHourMinute(new Date(), timezone);
  const localTime = `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`;
  if (kind === 'adaptive') {
    return (
      localTime >= profile.adaptive_start_time.slice(0, 5) &&
      localTime <= profile.adaptive_end_time.slice(0, 5)
    );
  }
  if (kind === 'daily')
    return localTime >= profile.daily_check_in_time.slice(0, 5);
  if (kind === 'weekly') {
    return (
      dayOfWeek(today) === profile.weekly_review_day &&
      localTime >= profile.weekly_review_time.slice(0, 5)
    );
  }
  return localTime >= '17:00';
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
    if (!(await proactiveDeliveryAllowed(item))) {
      await telegramQueueRepository.skipDelivery(
        item.id,
        'proactive_delivery_no_longer_due'
      );
      return true;
    }
    const telegramChatId = await coachTelegramRepository.getConnectedChatId(
      item.userId
    );
    if (
      !telegramChatId ||
      (item.telegramChatId && item.telegramChatId !== telegramChatId)
    ) {
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
      // Apply connection changes such as /stop before sending a queued reply.
      const hadUpdate = await processOneUpdate(handler);
      const hadDelivery = await processOneDelivery();
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
