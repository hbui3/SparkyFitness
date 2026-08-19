import { beforeEach, describe, expect, it, vi } from 'vitest';
import telegramQueueRepository from '../models/telegramQueueRepository.js';
import coachTelegramRepository from '../models/coachTelegramRepository.js';
import {
  isTelegramConfigured,
  sendTelegramMessage,
} from '../services/telegramApiService.js';
import { processTelegramQueues } from '../services/telegramQueueService.js';

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

describe('telegram queue worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(telegramQueueRepository.cleanupQueues).mockResolvedValue();
    vi.mocked(telegramQueueRepository.claimNextUpdate).mockResolvedValue(null);
    vi.mocked(telegramQueueRepository.claimNextDelivery).mockResolvedValue(
      null
    );
    vi.mocked(isTelegramConfigured).mockResolvedValue(true);
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
});
