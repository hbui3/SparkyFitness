import { beforeEach, describe, expect, it, vi } from 'vitest';
import telegramCoachService, {
  parseDirectWaterLogCommand,
} from '../services/telegramCoachService.js';
import coachTelegramRepository from '../models/coachTelegramRepository.js';
import chatService from '../services/chatService.js';
import {
  downloadTelegramImage,
  getTelegramBotUsername,
  sendTelegramMessage,
} from '../services/telegramApiService.js';
import { CHAT_TOOL_CATEGORY_SLUGS } from '@workspace/shared';
import measurementService from '../services/measurementService.js';

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
  isImageFollowUpText: vi.fn((value: string) =>
    /^(?:logge es|log it|ja|yes)$/i.test(value.trim())
  ),
  default: {
    getSparkyChatHistory: vi.fn(),
    getActiveAiServiceSetting: vi.fn(),
    processChatMessage: vi.fn(),
    saveSparkyChatHistory: vi.fn(),
  },
}));
vi.mock('../services/measurementService.js', () => ({
  default: {
    getWaterIntake: vi.fn(),
    logWaterIntakeAmount: vi.fn(),
  },
}));
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn().mockResolvedValue('Europe/Berlin'),
}));
vi.mock('../services/telegramApiService.js', () => ({
  downloadTelegramImage: vi.fn(),
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
    vi.mocked(downloadTelegramImage).mockResolvedValue({
      dataUrl: 'data:image/jpeg;base64,/9j/',
      mimeType: 'image/jpeg',
    });
    vi.mocked(chatService.saveSparkyChatHistory).mockResolvedValue({
      message: 'saved',
    });
  });

  it('recognizes only unambiguous water log statements', () => {
    expect(parseDirectWaterLogCommand('300ml Wasser')).toEqual({
      amountMl: 300,
      language: 'de',
    });
    expect(parseDirectWaterLogCommand('0,3 l Wasser getrunken')).toEqual({
      amountMl: 300,
      language: 'de',
    });
    expect(parseDirectWaterLogCommand('I drank 12 oz water')).toBeNull();
    expect(parseDirectWaterLogCommand('Wie viel Wasser fehlt mir?')).toBeNull();
    expect(
      parseDirectWaterLogCommand('Mein Ziel ist 3000 ml Wasser')
    ).toBeNull();
    expect(parseDirectWaterLogCommand('Nicht 300 ml Wasser')).toBeNull();
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
      service_type: 'openai',
      chat_tool_profile: 'full',
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
        false,
        [...CHAT_TOOL_CATEGORY_SLUGS]
      );
      expect(sendTelegramMessage).toHaveBeenCalledWith(
        '12345',
        'Noch 35 g Protein. Plane jetzt Skyr ein.'
      );
    });
  });

  it('logs an explicit water amount without AI and confirms the database total', async () => {
    vi.mocked(coachTelegramRepository.claimIncomingUpdate).mockResolvedValue({
      userId: 'user-1',
      claimed: true,
    });
    vi.mocked(chatService.getSparkyChatHistory).mockResolvedValue([] as never);
    vi.mocked(chatService.getActiveAiServiceSetting).mockResolvedValue({
      id: 'ai-1',
      service_type: 'openai',
      chat_tool_profile: 'full',
    } as never);
    vi.mocked(measurementService.getWaterIntake)
      .mockResolvedValueOnce({ water_ml: 1200 } as never)
      .mockResolvedValueOnce({ water_ml: 1500 } as never);
    vi.mocked(measurementService.logWaterIntakeAmount).mockResolvedValue({
      id: 'water-1',
    } as never);

    await telegramCoachService.handleTelegramUpdate({
      update_id: 21,
      message: {
        chat: { id: 12345, type: 'private' },
        text: '300ml Wasser',
      },
    });

    await vi.waitFor(() => {
      expect(measurementService.logWaterIntakeAmount).toHaveBeenCalledWith(
        'user-1',
        'user-1',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        300,
        'manual'
      );
      expect(chatService.processChatMessage).not.toHaveBeenCalled();
      expect(sendTelegramMessage).toHaveBeenCalledWith(
        '12345',
        expect.stringMatching(/Datenbank gelesener Stand: \*\*1500 ml\*\*/)
      );
      expect(chatService.saveSparkyChatHistory).toHaveBeenCalledTimes(2);
    });
  });

  it('never confirms a direct water log when persistence fails', async () => {
    vi.mocked(coachTelegramRepository.claimIncomingUpdate).mockResolvedValue({
      userId: 'user-1',
      claimed: true,
    });
    vi.mocked(chatService.getSparkyChatHistory).mockResolvedValue([] as never);
    vi.mocked(chatService.getActiveAiServiceSetting).mockResolvedValue({
      id: 'ai-1',
      service_type: 'openai',
      chat_tool_profile: 'full',
    } as never);
    vi.mocked(measurementService.getWaterIntake).mockResolvedValue({
      water_ml: 1200,
    } as never);
    vi.mocked(measurementService.logWaterIntakeAmount).mockRejectedValue(
      new Error('database unavailable')
    );

    await telegramCoachService.handleTelegramUpdate({
      update_id: 22,
      message: {
        chat: { id: 12345, type: 'private' },
        text: '300 ml Wasser',
      },
    });

    await vi.waitFor(() => {
      expect(sendTelegramMessage).toHaveBeenCalledWith(
        '12345',
        expect.stringContaining('nicht speichern')
      );
      expect(sendTelegramMessage).not.toHaveBeenCalledWith(
        '12345',
        expect.stringContaining('Erfasst und gespeichert')
      );
      expect(chatService.processChatMessage).not.toHaveBeenCalled();
    });
  });

  it('warns without suggesting a retry when the saved total cannot be verified', async () => {
    vi.mocked(coachTelegramRepository.claimIncomingUpdate).mockResolvedValue({
      userId: 'user-1',
      claimed: true,
    });
    vi.mocked(chatService.getSparkyChatHistory).mockResolvedValue([] as never);
    vi.mocked(chatService.getActiveAiServiceSetting).mockResolvedValue({
      id: 'ai-1',
      service_type: 'openai',
      chat_tool_profile: 'full',
    } as never);
    vi.mocked(measurementService.getWaterIntake)
      .mockResolvedValueOnce({ water_ml: 1200 } as never)
      .mockResolvedValueOnce({ water_ml: 1200 } as never);
    vi.mocked(measurementService.logWaterIntakeAmount).mockResolvedValue({
      id: 'water-1',
    } as never);

    await telegramCoachService.handleTelegramUpdate({
      update_id: 23,
      message: {
        chat: { id: 12345, type: 'private' },
        text: '300 ml Wasser',
      },
    });

    await vi.waitFor(() => {
      expect(sendTelegramMessage).toHaveBeenCalledWith(
        '12345',
        expect.stringContaining('wurde gespeichert')
      );
      expect(sendTelegramMessage).toHaveBeenCalledWith(
        '12345',
        expect.stringContaining('bevor du ihn erneut sendest')
      );
    });
  });

  it('reuses the latest web tool selection for the active AI service', async () => {
    vi.mocked(coachTelegramRepository.claimIncomingUpdate).mockResolvedValue({
      userId: 'user-1',
      claimed: true,
    });
    vi.mocked(chatService.getSparkyChatHistory).mockResolvedValue([
      {
        message_type: 'user',
        content: 'Zeige meine Trends',
        metadata: {
          chatToolConfiguration: {
            version: 1,
            serviceConfigId: 'ai-1',
            toolCategories: ['reports', 'coaching'],
          },
        },
      },
      { message_type: 'assistant', content: 'Hier sind deine Trends.' },
    ] as never);
    vi.mocked(chatService.getActiveAiServiceSetting).mockResolvedValue({
      id: 'ai-1',
      service_type: 'openai',
      chat_tool_profile: 'full',
    } as never);
    vi.mocked(chatService.processChatMessage).mockResolvedValue({
      content: 'Ich nutze dieselben Analysewerkzeuge.',
    } as never);

    await telegramCoachService.handleTelegramUpdate({
      update_id: 12,
      message: {
        chat: { id: 12345, type: 'private' },
        text: 'Und wie sieht es heute aus?',
      },
    });

    await vi.waitFor(() => {
      expect(chatService.processChatMessage).toHaveBeenCalledWith(
        expect.any(Array),
        'ai-1',
        'user-1',
        'user-1',
        false,
        ['reports', 'coaching']
      );
    });
  });

  it('downloads a Telegram photo with its caption and uses native vision with food tools', async () => {
    vi.mocked(coachTelegramRepository.claimIncomingUpdate).mockResolvedValue({
      userId: 'user-1',
      claimed: true,
    });
    vi.mocked(chatService.getSparkyChatHistory).mockResolvedValue([
      {
        message_type: 'user',
        content: 'Zeige meine Trends',
        metadata: {
          chatToolConfiguration: {
            version: 1,
            serviceConfigId: 'ai-1',
            toolCategories: ['reports'],
          },
        },
      },
      { message_type: 'assistant', content: 'Hier sind deine Trends.' },
    ] as never);
    vi.mocked(chatService.getActiveAiServiceSetting).mockResolvedValue({
      id: 'ai-1',
      service_type: 'openai',
      chat_tool_profile: 'full',
    } as never);
    vi.mocked(chatService.processChatMessage).mockResolvedValue({
      content: 'Ich habe zwei Stück eingetragen.',
    } as never);

    await telegramCoachService.handleTelegramUpdate({
      update_id: 13,
      message: {
        chat: { id: 12345, type: 'private' },
        caption: 'Dazu noch 2 Stück davon',
        photo: [
          { file_id: 'small', width: 100, height: 100, file_size: 1_000 },
          { file_id: 'large', width: 1_000, height: 1_000, file_size: 5_000 },
        ],
      },
    });

    await vi.waitFor(() => {
      expect(downloadTelegramImage).toHaveBeenCalledWith('large');
      expect(chatService.processChatMessage).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'Dazu noch 2 Stück davon',
            parts: [
              { type: 'text', text: 'Dazu noch 2 Stück davon' },
              {
                type: 'image',
                image: 'data:image/jpeg;base64,/9j/',
              },
            ],
          }),
        ]),
        'ai-1',
        'user-1',
        'user-1',
        false,
        ['food', 'reports']
      );
      expect(sendTelegramMessage).toHaveBeenCalledWith(
        '12345',
        'Ich habe zwei Stück eingetragen.'
      );
    });
  });

  it('restores stored image parts so a short follow-up can still refer to the photo', async () => {
    vi.mocked(coachTelegramRepository.claimIncomingUpdate).mockResolvedValue({
      userId: 'user-1',
      claimed: true,
    });
    vi.mocked(chatService.getSparkyChatHistory).mockResolvedValue([
      {
        message_type: 'user',
        content: '2 Stück davon',
        parts: [
          { type: 'text', text: '2 Stück davon' },
          { type: 'image', image: 'data:image/jpeg;base64,/9j/' },
        ],
      },
      {
        message_type: 'assistant',
        content: 'Soll ich die zwei Stück eintragen?',
      },
    ] as never);
    vi.mocked(chatService.getActiveAiServiceSetting).mockResolvedValue({
      id: 'ai-1',
      service_type: 'openai',
      chat_tool_profile: 'full',
    } as never);
    vi.mocked(chatService.processChatMessage).mockResolvedValue({
      content: 'Ich habe die zwei Stück eingetragen.',
    } as never);

    await telegramCoachService.handleTelegramUpdate({
      update_id: 14,
      message: {
        chat: { id: 12345, type: 'private' },
        text: 'Logge es',
      },
    });

    await vi.waitFor(() => {
      expect(chatService.processChatMessage).toHaveBeenCalledWith(
        [
          {
            role: 'user',
            content: '2 Stück davon',
            parts: [
              { type: 'text', text: '2 Stück davon' },
              { type: 'image', image: 'data:image/jpeg;base64,/9j/' },
            ],
          },
          {
            role: 'assistant',
            content: 'Soll ich die zwei Stück eintragen?',
          },
          { role: 'user', content: 'Logge es' },
        ],
        'ai-1',
        'user-1',
        'user-1',
        false,
        CHAT_TOOL_CATEGORY_SLUGS.filter((slug) => slug !== 'vision')
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
