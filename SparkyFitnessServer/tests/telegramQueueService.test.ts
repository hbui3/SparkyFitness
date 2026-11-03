import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoachProfiles } from '@workspace/shared';
import type { TelegramOutboxWorkItem } from '../models/telegramQueueRepository.js';
import telegramQueueRepository from '../models/telegramQueueRepository.js';
import coachTelegramRepository from '../models/coachTelegramRepository.js';
import {
  isTelegramConfigured,
  sendTelegramMessage,
} from '../services/telegramApiService.js';
import {
  processTelegramQueues,
  startTelegramQueueWorker,
  stopTelegramQueueWorker,
} from '../services/telegramQueueService.js';
import coachProfileRepository from '../models/coachProfileRepository.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';
import {
  isShuttingDown,
  pendingBackgroundWorkCount,
  waitForBackgroundWork,
} from '../utils/shutdownHooks.js';

vi.mock('../utils/shutdownHooks.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../utils/shutdownHooks.js')>();
  return { ...actual, isShuttingDown: vi.fn(() => false) };
});

vi.mock('../models/telegramQueueRepository.js', () => ({
  default: {
    enqueueDelivery: vi.fn(),
    claimNextUpdate: vi.fn(),
    completeUpdate: vi.fn(),
    retryUpdate: vi.fn(),
    claimNextDelivery: vi.fn(),
    completeDelivery: vi.fn(),
    skipDelivery: vi.fn(),
    retryDelivery: vi.fn(),
    cleanupQueues: vi.fn(),
  },
}));
vi.mock('../models/coachTelegramRepository.js', () => ({
  default: { getConnectedChatId: vi.fn() },
}));
vi.mock('../services/telegramApiService.js', () => ({
  isTelegramConfigured: vi.fn(),
  sendTelegramMessage: vi.fn(),
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../models/coachProfileRepository.js', () => ({
  default: { getCoachProfile: vi.fn() },
}));
vi.mock('../utils/timezoneLoader.js', () => ({ loadUserTimezone: vi.fn() }));

const profile: CoachProfiles = {
  id: 'profile-1' as CoachProfiles['id'],
  user_id: 'user-1',
  enabled: true,
  dietary_pattern: 'omnivore',
  excluded_ingredients: [],
  preferred_ingredients: [],
  disliked_ingredients: [],
  routines: [],
  coaching_notes: null,
  adaptive_check_ins_enabled: true,
  adaptive_last_sent_slot: null,
  adaptive_start_time: '07:00',
  adaptive_end_time: '20:00',
  adaptive_interval_minutes: 120,
  proactive_categories: ['nutrition', 'hydration', 'training', 'recovery'],
  adaptive_last_signature: null,
  memory_enabled: true,
  auto_memory_enabled: false,
  daily_check_in_enabled: true,
  daily_check_in_time: '20:00',
  weekly_review_enabled: true,
  weekly_review_day: 0,
  weekly_review_time: '18:00',
  daily_last_sent_on: null,
  weekly_last_sent_on: null,
  created_at: new Date('2026-11-03T10:00:00Z'),
  updated_at: new Date('2026-11-03T10:00:00Z'),
};

function pendingDelivery(
  overrides: Partial<TelegramOutboxWorkItem> = {}
): TelegramOutboxWorkItem {
  return {
    id: '123e4567-e89b-42d3-a456-426614174000',
    userId: 'user-1',
    telegramChatId: '12345',
    content: 'A private coach response',
    buttons: [],
    attemptCount: 1,
    idempotencyKey: 'chat:reply-1',
    ...overrides,
  };
}

function claimDelivery(item: TelegramOutboxWorkItem): void {
  vi.mocked(telegramQueueRepository.claimNextDelivery)
    .mockResolvedValueOnce(item)
    .mockResolvedValue(null);
}

describe('telegram queue worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isShuttingDown).mockReturnValue(false);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
    vi.mocked(telegramQueueRepository.cleanupQueues).mockResolvedValue();
    vi.mocked(telegramQueueRepository.claimNextUpdate).mockResolvedValue(null);
    vi.mocked(telegramQueueRepository.claimNextDelivery).mockResolvedValue(
      null
    );
    vi.mocked(isTelegramConfigured).mockResolvedValue(true);
    vi.mocked(coachTelegramRepository.getConnectedChatId).mockResolvedValue(
      '12345'
    );
    vi.mocked(coachProfileRepository.getCoachProfile).mockResolvedValue(
      profile
    );
    vi.mocked(loadUserTimezone).mockResolvedValue('Europe/Berlin');
  });
  afterEach(() => {
    stopTelegramQueueWorker();
    vi.useRealTimers();
  });

  it('does not claim more work after shutdown starts', async () => {
    vi.mocked(isShuttingDown).mockReturnValue(true);

    await processTelegramQueues(vi.fn());

    expect(telegramQueueRepository.claimNextUpdate).not.toHaveBeenCalled();
    expect(telegramQueueRepository.claimNextDelivery).not.toHaveBeenCalled();
  });

  it('keeps an active Telegram handler in the shutdown drain and leaves its reply queued', async () => {
    vi.mocked(telegramQueueRepository.claimNextUpdate).mockResolvedValueOnce({
      updateId: 42,
      payload: { update_id: 42 },
      attemptCount: 1,
    });
    let finish!: () => void;
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    startTelegramQueueWorker(handler);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    expect(pendingBackgroundWorkCount()).toBe(1);

    vi.mocked(isShuttingDown).mockReturnValue(true);
    stopTelegramQueueWorker();
    let drained = false;
    const drain = waitForBackgroundWork().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    finish();
    await drain;
    expect(telegramQueueRepository.completeUpdate).toHaveBeenCalledWith(42);
    expect(telegramQueueRepository.claimNextDelivery).not.toHaveBeenCalled();
    expect(pendingBackgroundWorkCount()).toBe(0);
  });

  it('completes a persisted update and its queued delivery', async () => {
    const update = {
      updateId: 41,
      payload: {
        update_id: 41,
        message: {
          chat: { id: 12345, type: 'private' as const },
          text: 'Hallo',
        },
      },
      attemptCount: 1,
    };
    const delivery = {
      id: '123e4567-e89b-42d3-a456-426614174000',
      userId: 'user-1',
      telegramChatId: null,
      content: 'Antwort',
      buttons: [[{ text: 'Heute', callback_data: 'today' }]],
      attemptCount: 1,
      idempotencyKey: 'chat:reply-1',
    };
    vi.mocked(telegramQueueRepository.claimNextUpdate)
      .mockResolvedValueOnce(update)
      .mockResolvedValue(null);
    vi.mocked(telegramQueueRepository.claimNextDelivery)
      .mockResolvedValueOnce(delivery)
      .mockResolvedValue(null);
    vi.mocked(coachTelegramRepository.getConnectedChatId).mockResolvedValue(
      '12345'
    );
    const handler = vi.fn().mockResolvedValue(undefined);

    await processTelegramQueues(handler);

    expect(handler).toHaveBeenCalledWith(update.payload);
    expect(telegramQueueRepository.completeUpdate).toHaveBeenCalledWith(41);
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      '12345',
      'Antwort',
      delivery.buttons
    );
    expect(telegramQueueRepository.completeDelivery).toHaveBeenCalledWith(
      delivery.id
    );
  });

  it('retries a failed update instead of acknowledging it as processed', async () => {
    vi.mocked(telegramQueueRepository.claimNextUpdate)
      .mockResolvedValueOnce({
        updateId: 42,
        payload: { update_id: 42 },
        attemptCount: 3,
      })
      .mockResolvedValue(null);
    const handler = vi.fn().mockRejectedValue(new Error('temporary failure'));

    await processTelegramQueues(handler);

    expect(telegramQueueRepository.completeUpdate).not.toHaveBeenCalled();
    expect(telegramQueueRepository.retryUpdate).toHaveBeenCalledWith(
      42,
      3,
      'telegram_processing_error'
    );
  });

  it('never sends a queued message to a disconnected chat even with an explicit recipient', async () => {
    const item = pendingDelivery();
    claimDelivery(item);
    vi.mocked(coachTelegramRepository.getConnectedChatId).mockResolvedValue(
      null
    );

    await processTelegramQueues(vi.fn());

    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(telegramQueueRepository.skipDelivery).toHaveBeenCalledWith(
      item.id,
      'telegram_connection_unavailable'
    );
  });

  it('does not send an old explicit recipient to either chat after reconnecting', async () => {
    const item = pendingDelivery();
    claimDelivery(item);
    vi.mocked(coachTelegramRepository.getConnectedChatId).mockResolvedValue(
      '67890'
    );

    await processTelegramQueues(vi.fn());

    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(telegramQueueRepository.skipDelivery).toHaveBeenCalledWith(
      item.id,
      'telegram_connection_unavailable'
    );
  });

  it('applies a pending disconnect before processing the next queued delivery', async () => {
    claimDelivery(pendingDelivery());
    vi.mocked(telegramQueueRepository.claimNextUpdate)
      .mockResolvedValueOnce({
        updateId: 43,
        payload: { update_id: 43 },
        attemptCount: 1,
      })
      .mockResolvedValue(null);
    let disconnect: () => void = () => undefined;
    const disconnected = new Promise<void>((resolve) => {
      disconnect = () => {
        vi.mocked(coachTelegramRepository.getConnectedChatId).mockResolvedValue(
          null
        );
        resolve();
      };
    });
    const handler = vi.fn(() => disconnected);
    const processing = processTelegramQueues(handler);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    const sentBeforeDisconnect =
      vi.mocked(sendTelegramMessage).mock.calls.length;
    disconnect();
    await processing;

    expect(sentBeforeDisconnect).toBe(0);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(telegramQueueRepository.skipDelivery).toHaveBeenCalled();
  });

  it.each([
    ['adaptive', { adaptive_check_ins_enabled: false }],
    ['daily', { daily_check_in_enabled: false }],
    ['weekly', { weekly_review_enabled: false }],
    ['restock', { proactive_categories: ['hydration'] }],
    [
      'restock',
      { adaptive_check_ins_enabled: false, daily_check_in_enabled: false },
    ],
    ['daily', { enabled: false }],
  ] satisfies Array<[string, Partial<CoachProfiles>]>)(
    'skips pending %s messages after the owner disables their schedule',
    async (kind, changedProfile) => {
      const item = pendingDelivery({
        idempotencyKey: `proactive:user-1:${kind}:2026-11-03T12:00`,
      });
      claimDelivery(item);
      vi.mocked(coachProfileRepository.getCoachProfile).mockResolvedValue({
        ...profile,
        ...changedProfile,
      });

      await processTelegramQueues(vi.fn());

      expect(sendTelegramMessage).not.toHaveBeenCalled();
      expect(telegramQueueRepository.skipDelivery).toHaveBeenCalledWith(
        item.id,
        'proactive_delivery_no_longer_due'
      );
    }
  );

  it('drops an outdated proactive message after a longer interruption', async () => {
    const item = pendingDelivery({
      idempotencyKey: 'proactive:user-1:daily:2026-11-02',
    });
    claimDelivery(item);

    await processTelegramQueues(vi.fn());

    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(telegramQueueRepository.skipDelivery).toHaveBeenCalledWith(
      item.id,
      'proactive_delivery_no_longer_due'
    );
  });

  it('uses the owner timezone rather than UTC to decide which proactive day is current', async () => {
    vi.setSystemTime(new Date('2026-11-03T23:30:00Z'));
    vi.mocked(loadUserTimezone).mockResolvedValue('Asia/Tokyo');
    vi.mocked(coachProfileRepository.getCoachProfile).mockResolvedValue({
      ...profile,
      daily_check_in_time: '00:15',
    });
    const item = pendingDelivery({
      idempotencyKey: 'proactive:user-1:daily:2026-11-04',
    });
    claimDelivery(item);

    await processTelegramQueues(vi.fn());

    expect(sendTelegramMessage).toHaveBeenCalledWith('12345', item.content, []);
  });

  it.each([
    ['adaptive', { adaptive_end_time: '12:00' }],
    ['daily', { daily_check_in_time: '20:00' }],
    ['weekly', { weekly_review_day: 0, weekly_review_time: '12:00' }],
    ['restock', {}],
  ] satisfies Array<[string, Partial<CoachProfiles>]>)(
    'honors the current %s delivery window after scheduling changes',
    async (kind, changedProfile) => {
      const item = pendingDelivery({
        idempotencyKey: `proactive:user-1:${kind}:2026-11-03T12:00`,
      });
      claimDelivery(item);
      vi.mocked(coachProfileRepository.getCoachProfile).mockResolvedValue({
        ...profile,
        ...changedProfile,
      });

      await processTelegramQueues(vi.fn());

      expect(sendTelegramMessage).not.toHaveBeenCalled();
      expect(telegramQueueRepository.skipDelivery).toHaveBeenCalledWith(
        item.id,
        'proactive_delivery_no_longer_due'
      );
    }
  );

  it.each(['adaptive', 'daily', 'weekly', 'restock'])(
    'delivers a currently authorized %s message in its local window',
    async (kind) => {
      vi.setSystemTime(new Date('2026-11-03T18:00:00Z'));
      const item = pendingDelivery({
        idempotencyKey: `proactive:user-1:${kind}:2026-11-03T18:00`,
      });
      claimDelivery(item);
      vi.mocked(coachProfileRepository.getCoachProfile).mockResolvedValue({
        ...profile,
        daily_check_in_time: '18:00',
        weekly_review_time: '18:00',
        weekly_review_day: 2,
      });

      await processTelegramQueues(vi.fn());

      expect(sendTelegramMessage).toHaveBeenCalledWith(
        '12345',
        item.content,
        []
      );
      expect(telegramQueueRepository.skipDelivery).not.toHaveBeenCalled();
    }
  );

  it('keeps a direct reply deliverable across midnight when proactive coaching is disabled', async () => {
    vi.setSystemTime(new Date('2026-11-03T23:30:00Z'));
    vi.mocked(coachProfileRepository.getCoachProfile).mockResolvedValue({
      ...profile,
      enabled: false,
    });
    const item = pendingDelivery();
    claimDelivery(item);

    await processTelegramQueues(vi.fn());

    expect(sendTelegramMessage).toHaveBeenCalledWith('12345', item.content, []);
    expect(coachProfileRepository.getCoachProfile).not.toHaveBeenCalled();
  });
});
