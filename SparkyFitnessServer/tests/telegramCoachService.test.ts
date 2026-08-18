import { beforeEach, describe, expect, it, vi } from 'vitest';
import telegramCoachService from '../services/telegramCoachService.js';
import coachTelegramRepository from '../models/coachTelegramRepository.js';
import chatService from '../services/chatService.js';
import {
  getTelegramBotUsername,
  sendTelegramMessage,
} from '../services/telegramApiService.js';

vi.mock('../models/coachTelegramRepository.js', () => ({
  default: {
    getConnection: vi.fn(),
    storeLinkToken: vi.fn(),
    claimLinkToken: vi.fn(),
    claimIncomingUpdate: vi.fn(),
    getConnectedChatId: vi.fn(),
    disconnectUser: vi.fn(),
    disconnectChat: vi.fn(),
  },
}));
vi.mock('../models/userRepository.js', () => ({
  default: { findUserById: vi.fn().mockResolvedValue({ role: 'user' }) },
}));
vi.mock('../services/chatService.js', () => ({
  default: {
    getSparkyChatHistory: vi.fn(),
    getActiveAiServiceSetting: vi.fn(),
    processChatMessage: vi.fn(),
  },
}));
vi.mock('../services/telegramApiService.js', () => ({
  getTelegramBotUsername: vi.fn(),
  isTelegramConfigured: vi.fn(() => true),
  sendTelegramMessage: vi.fn(),
  sendTelegramTyping: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

describe('telegramCoachService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTelegramBotUsername).mockResolvedValue('sparky_bot');
    vi.mocked(coachTelegramRepository.storeLinkToken).mockResolvedValue();
    vi.mocked(sendTelegramMessage).mockResolvedValue();
  });

  it('creates a short-lived link without storing its plaintext token', async () => {
    const link = await telegramCoachService.createLink('user-1');

    expect(link.url).toMatch(
      /^https:\/\/t\.me\/sparky_bot\?start=[A-Za-z0-9_-]+$/
    );
    const plaintextToken = new URL(link.url).searchParams.get('start');
    const storedHash = vi.mocked(coachTelegramRepository.storeLinkToken).mock
      .calls[0][1];
    expect(storedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedHash).not.toBe(plaintextToken);
  });

  it('pairs a private Telegram chat through the one-time start token', async () => {
    vi.mocked(coachTelegramRepository.claimLinkToken).mockResolvedValue(
      'user-1'
    );

    await telegramCoachService.handleTelegramUpdate({
      update_id: 10,
      message: {
        chat: { id: 12345, type: 'private' },
        from: { id: 777, username: 'h' },
        text: '/start valid-token',
      },
    });

    expect(coachTelegramRepository.claimLinkToken).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramChatId: '12345',
        telegramUserId: '777',
        telegramUsername: 'h',
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    );
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      '12345',
      expect.stringContaining('Sparky Coach ist verbunden')
    );
  });

  it('routes Telegram replies through the active Sparky coach and chat history', async () => {
    vi.mocked(coachTelegramRepository.claimIncomingUpdate).mockResolvedValue({
      userId: 'user-1',
      claimed: true,
    });
    vi.mocked(chatService.getSparkyChatHistory).mockResolvedValue([
      { message_type: 'assistant', content: 'Vorherige Nachricht' },
    ] as never);
    vi.mocked(chatService.getActiveAiServiceSetting).mockResolvedValue({
      id: 'ai-1',
    } as never);
    vi.mocked(chatService.processChatMessage).mockResolvedValue({
      content: 'Noch 35 g Protein. Plane jetzt Skyr ein.',
    } as never);

    await telegramCoachService.handleTelegramUpdate({
      update_id: 11,
      message: {
        chat: { id: 12345, type: 'private' },
        text: 'Was fehlt mir heute noch?',
      },
    });

    await vi.waitFor(() => {
      expect(chatService.processChatMessage).toHaveBeenCalledWith(
        [
          { role: 'assistant', content: 'Vorherige Nachricht' },
          { role: 'user', content: 'Was fehlt mir heute noch?' },
        ],
        'ai-1',
        'user-1',
        'user-1',
        false
      );
      expect(sendTelegramMessage).toHaveBeenCalledWith(
        '12345',
        'Noch 35 g Protein. Plane jetzt Skyr ein.'
      );
    });
  });

  it('silently ignores a duplicate update already claimed by this chat', async () => {
    vi.mocked(coachTelegramRepository.claimIncomingUpdate).mockResolvedValue({
      userId: 'user-1',
      claimed: false,
    });

    await telegramCoachService.handleTelegramUpdate({
      update_id: 11,
      message: {
        chat: { id: 12345, type: 'private' },
        text: 'duplicate',
      },
    });

    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(chatService.processChatMessage).not.toHaveBeenCalled();
  });
});
