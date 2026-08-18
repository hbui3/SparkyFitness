import { createHash, randomBytes } from 'crypto';
import type {
  CoachTelegramConnectionStatus,
  CoachTelegramDisconnectResponse,
  CoachTelegramLinkResponse,
} from '@workspace/shared';
import coachTelegramRepository from '../models/coachTelegramRepository.js';
import userRepository from '../models/userRepository.js';
import chatService from './chatService.js';
import { resolveChatToolCategoriesFromHistory } from './chatToolConfigurationService.js';
import {
  getTelegramBotUsername,
  isTelegramConfigured,
  sendTelegramMessage,
  sendTelegramTyping,
} from './telegramApiService.js';
import { log } from '../config/logging.js';

const LINK_LIFETIME_MS = 15 * 60_000;
const MAX_TELEGRAM_HISTORY_MESSAGES = 50;

interface TelegramUser {
  id?: number;
  username?: string;
}

interface TelegramChat {
  id: number;
  type?: string;
}

interface TelegramMessage {
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

interface StoredChatMessage {
  message_type?: unknown;
  content?: unknown;
  metadata?: unknown;
}

const userQueues = new Map<string, Promise<void>>();

function hashLinkToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function getConnectionStatus(
  userId: string
): Promise<CoachTelegramConnectionStatus> {
  const available = await isTelegramConfigured();
  const [connection, botUsername] = await Promise.all([
    coachTelegramRepository.getConnection(userId),
    available
      ? getTelegramBotUsername().catch((error) => {
          log('warn', 'Failed to load Telegram bot identity:', error);
          return null;
        })
      : Promise.resolve(null),
  ]);
  return {
    available,
    connected: Boolean(
      connection?.enabled && connection.telegram_chat_id !== null
    ),
    botUsername,
    telegramUsername: connection?.telegram_username ?? null,
  };
}

async function createLink(userId: string): Promise<CoachTelegramLinkResponse> {
  if (!(await isTelegramConfigured())) {
    throw new Error('Telegram coach integration is not configured.');
  }
  const botUsername = await getTelegramBotUsername();
  if (!botUsername) throw new Error('Telegram bot username is unavailable.');
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + LINK_LIFETIME_MS);
  await coachTelegramRepository.storeLinkToken(
    userId,
    hashLinkToken(token),
    expiresAt
  );
  return {
    url: `https://t.me/${botUsername}?start=${token}`,
    expiresAt: expiresAt.toISOString(),
    botUsername,
  };
}

async function disconnect(
  userId: string
): Promise<CoachTelegramDisconnectResponse> {
  return {
    disconnected: await coachTelegramRepository.disconnectUser(userId),
  };
}

async function sendProactiveCoachMessage(
  userId: string,
  content: string
): Promise<boolean> {
  const telegramChatId =
    await coachTelegramRepository.getConnectedChatId(userId);
  if (!telegramChatId || !(await isTelegramConfigured())) return false;
  await sendTelegramMessage(telegramChatId, content);
  return true;
}

function enqueueForUser(userId: string, task: () => Promise<void>): void {
  const previous = userQueues.get(userId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      if (userQueues.get(userId) === current) userQueues.delete(userId);
    });
  userQueues.set(userId, current);
  void current.catch((error) => {
    log('error', `Telegram coach task failed for user ${userId}:`, error);
  });
}

async function answerTelegramChat(
  userId: string,
  telegramChatId: string,
  text: string
): Promise<void> {
  await sendTelegramTyping(telegramChatId).catch(() => undefined);
  try {
    const [history, activeSetting, user] = await Promise.all([
      chatService.getSparkyChatHistory(userId, userId),
      chatService.getActiveAiServiceSetting(userId, userId),
      userRepository.findUserById(userId),
    ]);
    if (!activeSetting?.id) {
      await sendTelegramMessage(
        telegramChatId,
        'In SparkyFitness ist noch kein aktiver KI-Anbieter ausgewählt. Öffne die Web-Einstellungen, wähle einen Anbieter und schreibe mir dann erneut.'
      );
      return;
    }
    const storedHistory = history as StoredChatMessage[];
    const toolCategories = resolveChatToolCategoriesFromHistory(
      storedHistory,
      String(activeSetting.id),
      String(activeSetting.service_type ?? ''),
      activeSetting.chat_tool_profile
    );
    const messages = storedHistory
      .slice(-MAX_TELEGRAM_HISTORY_MESSAGES)
      .filter(
        (entry) =>
          (entry.message_type === 'user' ||
            entry.message_type === 'assistant') &&
          typeof entry.content === 'string'
      )
      .map((entry) => ({
        role: String(entry.message_type),
        content: String(entry.content),
      }));
    messages.push({ role: 'user', content: text });
    const result = await chatService.processChatMessage(
      messages,
      String(activeSetting.id),
      userId,
      userId,
      user?.role === 'admin',
      toolCategories
    );
    await sendTelegramMessage(telegramChatId, result.content);
  } catch (error) {
    log('error', `Telegram chat processing failed for user ${userId}:`, error);
    await sendTelegramMessage(
      telegramChatId,
      'Der Coach konnte diese Nachricht gerade nicht verarbeiten. Bitte versuche es später noch einmal.'
    );
  }
}

async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  const updateId = update.update_id;
  if (
    !message ||
    typeof updateId !== 'number' ||
    !Number.isSafeInteger(updateId)
  ) {
    return;
  }
  const telegramChatId = String(message.chat.id);
  if (message.chat.type && message.chat.type !== 'private') {
    await sendTelegramMessage(
      telegramChatId,
      'Bitte verwende den Sparky Coach nur in einem privaten Telegram-Chat.'
    );
    return;
  }
  const text = message.text?.trim();
  if (!text) {
    await sendTelegramMessage(
      telegramChatId,
      'Ich kann momentan Textnachrichten verarbeiten. Fotos und Sprachnachrichten folgen später.'
    );
    return;
  }

  const startMatch = text.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]+))?$/i);
  if (startMatch) {
    const token = startMatch[1];
    if (!token) {
      await sendTelegramMessage(
        telegramChatId,
        'Öffne in SparkyFitness die Coach-Einstellungen und verwende dort „Telegram verbinden“. Der Link koppelt diesen Chat sicher mit deinem Konto.'
      );
      return;
    }
    const linkedUserId = await coachTelegramRepository.claimLinkToken({
      tokenHash: hashLinkToken(token),
      telegramChatId,
      telegramUserId:
        message.from?.id === undefined ? null : String(message.from.id),
      telegramUsername: message.from?.username ?? null,
    });
    await sendTelegramMessage(
      telegramChatId,
      linkedUserId
        ? 'Sparky Coach ist verbunden. Proaktive Check-ins erscheinen ab jetzt hier. Du kannst mir außerdem direkt antworten; alles bleibt im selben privaten Sparky-Chatverlauf.'
        : 'Dieser Verbindungslink ist ungültig oder abgelaufen. Erzeuge in SparkyFitness einen neuen Link.'
    );
    return;
  }

  const connection = await coachTelegramRepository.claimIncomingUpdate(
    telegramChatId,
    updateId
  );
  if (!connection) {
    await sendTelegramMessage(
      telegramChatId,
      'Dieser Telegram-Chat ist nicht mit SparkyFitness verbunden. Erzeuge zuerst in den Coach-Einstellungen einen Verbindungslink.'
    );
    return;
  }
  if (!connection.claimed) return;
  const { userId } = connection;

  if (/^\/(stop|disconnect)(?:@\w+)?$/i.test(text)) {
    await coachTelegramRepository.disconnectChat(telegramChatId);
    await sendTelegramMessage(
      telegramChatId,
      'Die Telegram-Verbindung wurde getrennt. Deine Daten und dein Chatverlauf bleiben in SparkyFitness erhalten.'
    );
    return;
  }

  enqueueForUser(userId, () =>
    answerTelegramChat(userId, telegramChatId, text)
  );
}

export default {
  getConnectionStatus,
  createLink,
  disconnect,
  sendProactiveCoachMessage,
  handleTelegramUpdate,
};
