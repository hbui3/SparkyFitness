import { beforeEach, describe, expect, it, vi } from 'vitest';
import telegramCoachService, {
  parseDirectWaterLogCommand,
} from '../services/telegramCoachService.js';
import coachTelegramRepository from '../models/coachTelegramRepository.js';
import chatService from '../services/chatService.js';
import {
  answerTelegramCallbackQuery,
  downloadTelegramAudio,
  downloadTelegramImage,
  getTelegramBotUsername,
  sendTelegramMessage,
} from '../services/telegramApiService.js';
import { CHAT_TOOL_CATEGORY_SLUGS } from '@workspace/shared';
import measurementService from '../services/measurementService.js';
import telegramQueueService from '../services/telegramQueueService.js';
import coachActionRepository from '../models/coachActionRepository.js';
import coachContextService from '../services/coachContextService.js';
import coachProfileRepository from '../models/coachProfileRepository.js';
import { dispatchAudioTranscription } from '../ai/providerDispatch.js';

vi.mock('../models/coachTelegramRepository.js', () => ({
  default: {
    getConnection: vi.fn(),
    storeLinkToken: vi.fn(),
    claimLinkToken: vi.fn(),
    claimIncomingUpdate: vi.fn(),
    getConnectionByChatId: vi.fn(),
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
    getActiveAiServiceSettingForBackend: vi.fn(),
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
vi.mock('../models/coachActionRepository.js', () => ({
  default: {
    createReceipt: vi.fn(),
    claimUndo: vi.fn(),
    restoreCompleted: vi.fn(),
  },
}));
vi.mock('../models/coachProfileRepository.js', () => ({
  default: { getCoachLanguage: vi.fn() },
}));
vi.mock('../services/coachContextService.js', () => ({
  default: {
    getCoachTodayStatus: vi.fn(),
    renderCoachTodayStatus: vi.fn(),
  },
}));
vi.mock('../ai/providerDispatch.js', () => ({
  dispatchAudioTranscription: vi.fn(),
}));
vi.mock('../services/telegramQueueService.js', () => ({
  default: { queueTelegramDelivery: vi.fn() },
}));
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn().mockResolvedValue('Europe/Berlin'),
}));
vi.mock('../services/telegramApiService.js', () => ({
  answerTelegramCallbackQuery: vi.fn(),
  downloadTelegramAudio: vi.fn(),
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
    vi.mocked(downloadTelegramAudio).mockResolvedValue({
      bytes: Buffer.from('voice'),
      mimeType: 'audio/ogg',
    });
    vi.mocked(coachProfileRepository.getCoachLanguage).mockResolvedValue('de');
    vi.mocked(coachContextService.getCoachTodayStatus).mockResolvedValue({
      date: '2026-08-19',
      timezone: 'Europe/Berlin',
      caloriesConsumed: 1800,
      caloriesBurned: 400,
      netCalories: 1400,
      calorieTarget: 3000,
      caloriesRemaining: 1200,
      proteinConsumedG: 120,
      proteinTargetG: 160,
      proteinRemainingG: 40,
      waterConsumedMl: 1500,
      waterTargetMl: 3000,
      waterRemainingMl: 1500,
      nextAction: 'Trinken',
    });
    vi.mocked(coachContextService.renderCoachTodayStatus).mockReturnValue(
      'Heute: 1800 gegessen, 400 verbrannt, 1400 netto.'
    );
    vi.mocked(coachTelegramRepository.getConnectionByChatId).mockResolvedValue({
      userId: 'user-1',
      telegramUserId: null,
    });
    vi.mocked(telegramQueueService.queueTelegramDelivery).mockResolvedValue(
      'delivery-1'
    );
    vi.mocked(coachActionRepository.createReceipt).mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      actionType: 'log_water',
      resourceType: 'water_log',
      resourceId: 'water-1',
      payload: {},
      status: 'completed',
      expiresAt: new Date(),
    });
    vi.mocked(chatService.saveSparkyChatHistory).mockResolvedValue({
      message: 'saved',
    });
  });

  it('recognizes only unambiguous water log statements', () => {
    expect(parseDirectWaterLogCommand('300ml')).toEqual({
      amountMl: 300,
      language: 'de',
    });
    expect(parseDirectWaterLogCommand('0,3 l')).toEqual({
      amountMl: 300,
      language: 'de',
    });
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
    expect(parseDirectWaterLogCommand('300 ml Milch')).toBeNull();
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
        [...CHAT_TOOL_CATEGORY_SLUGS],
        { allowAskUser: true }
      );
      expect(telegramQueueService.queueTelegramDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          telegramChatId: '12345',
          content: 'Noch 35 g Protein. Plane jetzt Skyr ein.',
        })
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
        text: '300ml',
      },
    });

    await vi.waitFor(() => {
      expect(measurementService.logWaterIntakeAmount).toHaveBeenCalledWith(
        'user-1',
        'user-1',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        300,
        'telegram',
        'update:21'
      );
      expect(chatService.processChatMessage).not.toHaveBeenCalled();
      expect(telegramQueueService.queueTelegramDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          telegramChatId: '12345',
          content: expect.stringMatching(
            /Datenbank gelesener Stand: \*\*1500 ml\*\*/
          ),
        })
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
      expect(telegramQueueService.queueTelegramDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('nicht speichern'),
        })
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
      expect(telegramQueueService.queueTelegramDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringMatching(
            /wurde gespeichert[\s\S]*bevor du ihn erneut sendest/
          ),
        })
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
      {
        message_type: 'assistant',
        content: 'Hier sind deine Trends.',
        metadata: {
          custom: {
            assistantExecution: {
              modelPurpose: 'chat',
              turnDomains: ['reports'],
            },
          },
        },
      },
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
        ['reports', 'coaching'],
        { allowAskUser: true }
      );
      const sentMessages = vi.mocked(chatService.processChatMessage).mock
        .calls[0]?.[0] as Array<{ role: string; metadata?: unknown }>;
      expect(sentMessages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            metadata: {
              custom: {
                assistantExecution: {
                  modelPurpose: 'chat',
                  turnDomains: ['reports'],
                },
              },
            },
          }),
        ])
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
        ['food', 'reports'],
        { allowAskUser: false }
      );
      expect(telegramQueueService.queueTelegramDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Ich habe zwei Stück eingetragen.',
        })
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
        CHAT_TOOL_CATEGORY_SLUGS.filter((slug) => slug !== 'vision'),
        { allowAskUser: true }
      );
    });
  });

  it('restores a pending quick-reply tool so a typed option resolves it', async () => {
    vi.mocked(coachTelegramRepository.claimIncomingUpdate).mockResolvedValue({
      userId: 'user-1',
      claimed: true,
    });
    const askInput = {
      mode: 'choose',
      question: 'Welches Brötchen meinst du?',
      options: ['Vollkornbrötchen', 'Weizenbrötchen', 'Laugenbrötchen'],
    };
    vi.mocked(chatService.getSparkyChatHistory).mockResolvedValue([
      {
        message_type: 'assistant',
        content: 'Welches Brötchen meinst du?',
        parts: [
          { type: 'text', text: 'Welches Brötchen meinst du?' },
          {
            type: 'tool-sparky_ask_user',
            toolCallId: 'ask-1',
            state: 'output-available',
            input: askInput,
            output: '',
          },
        ],
      },
    ] as never);
    vi.mocked(chatService.getActiveAiServiceSetting).mockResolvedValue({
      id: 'ai-1',
      service_type: 'openai',
      chat_tool_profile: 'full',
    } as never);
    vi.mocked(chatService.processChatMessage).mockResolvedValue({
      content: 'Das Weizenbrötchen wurde eingetragen.',
    } as never);

    await telegramCoachService.handleTelegramUpdate({
      update_id: 15,
      message: {
        chat: { id: 12345, type: 'private' },
        text: 'Weizenbrötchen habe ich gegessen',
      },
    });

    await vi.waitFor(() => {
      expect(chatService.processChatMessage).toHaveBeenCalledWith(
        [
          {
            role: 'assistant',
            content: 'Welches Brötchen meinst du?',
            parts: [
              { type: 'text', text: 'Welches Brötchen meinst du?' },
              {
                type: 'tool-sparky_ask_user',
                toolCallId: 'ask-1',
                state: 'output-available',
                input: askInput,
                output: '',
              },
            ],
          },
          { role: 'user', content: 'Weizenbrötchen habe ich gegessen' },
        ],
        'ai-1',
        'user-1',
        'user-1',
        false,
        [...CHAT_TOOL_CATEGORY_SLUGS],
        { allowAskUser: true }
      );
    });
  });

  it('rejects a Telegram sender that does not match the paired user', async () => {
    vi.mocked(coachTelegramRepository.getConnectionByChatId).mockResolvedValue({
      userId: 'user-1',
      telegramUserId: '777',
    });

    await telegramCoachService.handleTelegramUpdate({
      update_id: 11,
      message: {
        chat: { id: 12345, type: 'private' },
        from: { id: 999 },
        text: 'not mine',
      },
    });

    expect(sendTelegramMessage).toHaveBeenCalledWith(
      '12345',
      expect.stringContaining('nicht autorisiert')
    );
    expect(chatService.processChatMessage).not.toHaveBeenCalled();
  });

  it('answers the deterministic today quick action without an AI round-trip', async () => {
    vi.mocked(coachTelegramRepository.getConnectionByChatId).mockResolvedValue({
      userId: 'user-1',
      telegramUserId: '777',
    });

    await telegramCoachService.handleTelegramUpdate({
      update_id: 30,
      callback_query: {
        id: 'callback-1',
        from: { id: 777 },
        message: { chat: { id: 12345, type: 'private' } },
        data: 'today',
      },
    });

    expect(answerTelegramCallbackQuery).toHaveBeenCalledWith(
      'callback-1',
      'Wird verarbeitet …'
    );
    expect(chatService.processChatMessage).not.toHaveBeenCalled();
    expect(telegramQueueService.queueTelegramDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        content: expect.stringContaining('1400 netto'),
      })
    );
  });

  it('transcribes Telegram voice and routes the transcript through the same chat tools', async () => {
    vi.mocked(
      chatService.getActiveAiServiceSettingForBackend
    ).mockResolvedValue({
      service_type: 'openai',
      api_key: 'encrypted-backend-key',
    } as never);
    vi.mocked(dispatchAudioTranscription).mockResolvedValue({
      ok: true,
      text: 'Wie ist meine Erholung heute?',
      language: 'de',
    });
    vi.mocked(chatService.getSparkyChatHistory).mockResolvedValue([] as never);
    vi.mocked(chatService.getActiveAiServiceSetting).mockResolvedValue({
      id: 'ai-1',
      service_type: 'openai',
      chat_tool_profile: 'full',
    } as never);
    vi.mocked(chatService.processChatMessage).mockResolvedValue({
      content: 'Erledigt.',
    } as never);

    await telegramCoachService.handleTelegramUpdate({
      update_id: 31,
      message: {
        chat: { id: 12345, type: 'private' },
        voice: { file_id: 'voice-1', duration: 3 },
      },
    });

    expect(downloadTelegramAudio).toHaveBeenCalledWith('voice-1');
    expect(dispatchAudioTranscription).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'audio/ogg', languageHint: 'de' })
    );
    expect(chatService.processChatMessage).toHaveBeenCalledWith(
      [{ role: 'user', content: 'Wie ist meine Erholung heute?' }],
      'ai-1',
      'user-1',
      'user-1',
      false,
      [...CHAT_TOOL_CATEGORY_SLUGS],
      { allowAskUser: true }
    );
  });
});
