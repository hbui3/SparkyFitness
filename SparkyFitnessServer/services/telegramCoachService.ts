import { createHash, randomBytes } from 'crypto';
import {
  CHAT_TOOL_CATEGORY_SLUGS,
  type ChatToolCategorySlug,
  type CoachTelegramConnectionStatus,
  type CoachTelegramDisconnectResponse,
  type CoachTelegramLinkResponse,
} from '@workspace/shared';
import coachTelegramRepository from '../models/coachTelegramRepository.js';
import userRepository from '../models/userRepository.js';
import chatService, { isImageFollowUpText } from './chatService.js';
import { resolveChatToolCategoriesFromHistory } from './chatToolConfigurationService.js';
import {
  downloadTelegramImage,
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

interface TelegramPhotoSize {
  file_id: string;
  file_size?: number;
  width?: number;
  height?: number;
}

interface TelegramMessage {
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

interface StoredChatMessage {
  message_type?: unknown;
  content?: unknown;
  metadata?: unknown;
  parts?: unknown;
}

interface RuntimeChatMessagePart {
  type: 'text' | 'image';
  text?: string;
  image?: string;
}

interface RuntimeChatMessage {
  role: string;
  content: string;
  parts?: RuntimeChatMessagePart[];
}

interface TelegramChatInput {
  text: string;
  imageFileId?: string;
}

const userQueues = new Map<string, Promise<void>>();

function storedRuntimeParts(
  value: unknown
): RuntimeChatMessagePart[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value.flatMap<RuntimeChatMessagePart>((part) => {
    if (!part || typeof part !== 'object') return [];
    const candidate = part as Record<string, unknown>;
    if (candidate.type === 'text' && typeof candidate.text === 'string') {
      return [{ type: 'text', text: candidate.text }];
    }
    if (
      candidate.type === 'image' &&
      typeof candidate.image === 'string' &&
      candidate.image.startsWith('data:image/')
    ) {
      return [{ type: 'image', image: candidate.image }];
    }
    return [];
  });
  return parts.length > 0 ? parts : undefined;
}

function nativeFoodImageCategories(
  categories: readonly ChatToolCategorySlug[]
): ChatToolCategorySlug[] {
  const required = new Set<ChatToolCategorySlug>([
    ...categories.filter((slug) => slug !== 'vision'),
    'food',
  ]);
  return CHAT_TOOL_CATEGORY_SLUGS.filter((slug) => required.has(slug));
}

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
  input: TelegramChatInput
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
    let toolCategories = resolveChatToolCategoriesFromHistory(
      storedHistory,
      String(activeSetting.id),
      String(activeSetting.service_type ?? ''),
      activeSetting.chat_tool_profile
    );
    let imageDataUrl: string | undefined;
    if (input.imageFileId) {
      try {
        imageDataUrl = (await downloadTelegramImage(input.imageFileId)).dataUrl;
      } catch (error) {
        log(
          'error',
          `Telegram image download failed for user ${userId}:`,
          error
        );
        await sendTelegramMessage(
          telegramChatId,
          'Ich konnte das Foto nicht laden. Bitte sende es noch einmal als normales Bild und nicht als Datei.'
        );
        return;
      }
      // Telegram already supplies the photo as native multimodal input. The
      // vision tools require the model to repeat an image URL, which is both
      // unnecessary here and can make it misclassify the attached data URL as
      // an unsupported remote link. Keep the food tools, but let the model see
      // and read the image directly.
      toolCategories = nativeFoodImageCategories(toolCategories);
    } else if (isImageFollowUpText(input.text)) {
      const latestStoredUser = [...storedHistory]
        .reverse()
        .find((entry) => entry.message_type === 'user');
      if (
        storedRuntimeParts(latestStoredUser?.parts)?.some(
          (part) => part.type === 'image'
        )
      ) {
        toolCategories = nativeFoodImageCategories(toolCategories);
      }
    }
    const messages: RuntimeChatMessage[] = storedHistory
      .slice(-MAX_TELEGRAM_HISTORY_MESSAGES)
      .filter(
        (entry) =>
          (entry.message_type === 'user' ||
            entry.message_type === 'assistant') &&
          typeof entry.content === 'string'
      )
      .map((entry) => {
        const parts = storedRuntimeParts(entry.parts);
        return {
          role: String(entry.message_type),
          content: String(entry.content),
          ...(parts && { parts }),
        };
      });
    const currentMessage: RuntimeChatMessage = {
      role: 'user',
      content: input.text,
    };
    if (imageDataUrl) {
      currentMessage.parts = [
        { type: 'text', text: input.text },
        { type: 'image', image: imageDataUrl },
      ];
    }
    messages.push(currentMessage);
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

function selectLargestPhoto(
  photos: readonly TelegramPhotoSize[] | undefined
): TelegramPhotoSize | undefined {
  return photos
    ?.filter((photo) => Boolean(photo.file_id))
    .reduce<TelegramPhotoSize | undefined>((largest, photo) => {
      if (!largest) return photo;
      const score = photo.file_size ?? (photo.width ?? 0) * (photo.height ?? 0);
      const largestScore =
        largest.file_size ?? (largest.width ?? 0) * (largest.height ?? 0);
      return score >= largestScore ? photo : largest;
    }, undefined);
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
  const caption = message.caption?.trim();
  const photo = selectLargestPhoto(message.photo);
  if (!text && !photo) {
    await sendTelegramMessage(
      telegramChatId,
      'Ich kann Textnachrichten und Fotos verarbeiten. Sprachnachrichten folgen später.'
    );
    return;
  }

  const startMatch = text?.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]+))?$/i);
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

  if (text && /^\/(stop|disconnect)(?:@\w+)?$/i.test(text)) {
    await coachTelegramRepository.disconnectChat(telegramChatId);
    await sendTelegramMessage(
      telegramChatId,
      'Die Telegram-Verbindung wurde getrennt. Deine Daten und dein Chatverlauf bleiben in SparkyFitness erhalten.'
    );
    return;
  }

  enqueueForUser(userId, () =>
    answerTelegramChat(userId, telegramChatId, {
      text:
        text ||
        caption ||
        'Analysiere dieses Foto und füge das erkennbare Lebensmittel oder Gericht meinem heutigen Ernährungstagebuch hinzu.',
      imageFileId: photo?.file_id,
    })
  );
}

export default {
  getConnectionStatus,
  createLink,
  disconnect,
  sendProactiveCoachMessage,
  handleTelegramUpdate,
};
