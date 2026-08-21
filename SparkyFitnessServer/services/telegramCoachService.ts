import { createHash, randomBytes } from 'crypto';
import {
  CHAT_TOOL_CATEGORY_SLUGS,
  ASK_USER_TOOL_NAME,
  todayInZone,
  type ChatToolCategorySlug,
  type CoachTelegramConnectionStatus,
  type CoachTelegramDisconnectResponse,
  type CoachTelegramLinkResponse,
} from '@workspace/shared';
import coachTelegramRepository from '../models/coachTelegramRepository.js';
import userRepository from '../models/userRepository.js';
import chatService, { isImageFollowUpText } from './chatService.js';
import { resolveChatToolCategoriesFromHistory } from './chatToolConfigurationService.js';
import measurementService from './measurementService.js';
import coachContextService from './coachContextService.js';
import coachEventService from './coachEventService.js';
import telegramQueueService from './telegramQueueService.js';
import coachActionRepository from '../models/coachActionRepository.js';
import coachProfileRepository from '../models/coachProfileRepository.js';
import { dispatchAudioTranscription } from '../ai/providerDispatch.js';
import { deriveAiNetworkPolicy } from '../utils/outboundUrlPolicy.js';
import {
  answerTelegramCallbackQuery,
  downloadTelegramAudio,
  downloadTelegramImage,
  getTelegramBotUsername,
  isTelegramConfigured,
  sendTelegramMessage,
  sendTelegramTyping,
} from './telegramApiService.js';
import { log } from '../config/logging.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';
import { isWaterLogText } from '../utils/waterLogText.js';

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

interface TelegramAudio {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  duration?: number;
  mime_type?: string;
}

interface TelegramMessage {
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  voice?: TelegramAudio;
  audio?: TelegramAudio;
}

interface TelegramCallbackQuery {
  id: string;
  from?: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface StoredChatMessage {
  message_type?: unknown;
  content?: unknown;
  metadata?: unknown;
  parts?: unknown;
}

interface RuntimeChatMessagePart {
  type: string;
  text?: string;
  image?: string;
  input?: unknown;
  output?: unknown;
  toolCallId?: string;
  state?: string;
}

interface RuntimeChatMessage {
  role: string;
  content: string;
  metadata?: unknown;
  parts?: RuntimeChatMessagePart[];
}

interface TelegramChatInput {
  text: string;
  imageFileId?: string;
  updateId: number;
}

export interface DirectWaterLogCommand {
  amountMl: number;
  language: 'de' | 'en';
}

const WATER_COMMAND_EXCLUSION =
  /(?:\?|\b(?:wie\s+viel|how\s+much|ziel|goal|verbleib|remaining|fehlt|left|brauche|need|soll|should|genug|enough|empfiehl|recommend|nicht|kein(?:e|en|er|es)?|not|no)\b)/i;

/**
 * Recognizes only unambiguous, positive water log statements. Questions and
 * goal/advice requests stay in the regular AI path.
 */
export function parseDirectWaterLogCommand(
  text: string
): DirectWaterLogCommand | null {
  const normalized = text.trim();
  if (!isWaterLogText(normalized) || WATER_COMMAND_EXCLUSION.test(normalized)) {
    return null;
  }

  const matches = [
    ...normalized.matchAll(
      /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(ml|milliliter|millilitres?|l|liter|litre|litres?)(?=\s|$|[.!;,])/gi
    ),
  ];
  if (matches.length !== 1) return null;

  const amount = Number(matches[0]?.[1]?.replace(',', '.'));
  const unit = matches[0]?.[2]?.toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0 || !unit) return null;

  const amountMl = Math.round(
    unit === 'ml' || unit.startsWith('milli') ? amount : amount * 1000
  );
  if (amountMl <= 0 || amountMl > 10_000) return null;

  return {
    amountMl,
    language: /\bwater\b/i.test(normalized) ? 'en' : 'de',
  };
}

function waterTotalMl(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const waterMl = (value as Record<string, unknown>).water_ml;
  const parsed = Number(waterMl);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function saveDeterministicChatTurn(
  userId: string,
  userContent: string,
  assistantContent: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await chatService.saveSparkyChatHistory(userId, {
    content: userContent,
    messageType: 'user',
    metadata,
    parts: [{ type: 'text', text: userContent }],
  });
  await chatService.saveSparkyChatHistory(userId, {
    content: assistantContent,
    messageType: 'assistant',
    parts: [{ type: 'text', text: assistantContent }],
  });
}

async function answerDirectWaterLog(
  userId: string,
  telegramChatId: string,
  text: string,
  command: DirectWaterLogCommand,
  metadata: Record<string, unknown>,
  sourceId: string
): Promise<void> {
  let response: string;
  let writePersisted = false;
  let receiptId: string | null = null;
  try {
    const timezone = await loadUserTimezone(userId);
    const entryDate = todayInZone(timezone);
    const before = waterTotalMl(
      await measurementService.getWaterIntake(userId, userId, entryDate)
    );
    const logEntry = await measurementService.logWaterIntakeAmount(
      userId,
      userId,
      entryDate,
      command.amountMl,
      'telegram',
      sourceId
    );
    writePersisted = true;
    if (!logEntry?.id) {
      throw new Error('Water log did not return a stable entry ID.');
    }
    const receipt = await coachActionRepository.createReceipt({
      userId,
      actionType: 'log_water',
      resourceType: 'water_log',
      resourceId: String(logEntry.id),
      payload: { amountMl: command.amountMl, entryDate },
    });
    receiptId = receipt.id;
    const after = waterTotalMl(
      await measurementService.getWaterIntake(userId, userId, entryDate)
    );
    if (after < before + command.amountMl) {
      throw new Error(
        `Water verification failed: before=${before}, amount=${command.amountMl}, after=${after}`
      );
    }
    response =
      command.language === 'en'
        ? `Logged and saved: **${command.amountMl} ml water** for today.\nCurrent total read from the database: **${after} ml**.`
        : `Erfasst und gespeichert: **${command.amountMl} ml Wasser** für heute.\nAktueller, aus der Datenbank gelesener Stand: **${after} ml**.`;
  } catch (error) {
    log(
      'error',
      `Verified Telegram water log failed for user ${userId}:`,
      error
    );
    response = writePersisted
      ? command.language === 'en'
        ? 'The water entry was saved, but I could not verify the new total. Please check the web diary before sending it again.'
        : 'Der Wassereintrag wurde gespeichert, aber ich konnte den neuen Gesamtstand nicht verifizieren. Prüfe bitte das Web-Tagebuch, bevor du ihn erneut sendest.'
      : command.language === 'en'
        ? 'I could not save the water entry. Nothing has been confirmed; please try again.'
        : 'Ich konnte den Wassereintrag nicht speichern. Es wurde nichts bestätigt; bitte versuche es erneut.';
  }

  await saveDeterministicChatTurn(userId, text, response, metadata).catch(
    (error) =>
      log(
        'error',
        `Failed to save deterministic Telegram turn for user ${userId}:`,
        error
      )
  );
  if (writePersisted) coachEventService.publish(userId, 'water');
  await telegramQueueService.queueTelegramDelivery({
    userId,
    telegramChatId,
    content: response,
    buttons: receiptId
      ? [
          [
            { text: '↩️ Rückgängig', callback_data: `undo:${receiptId}` },
            { text: '📊 Heute', callback_data: 'today' },
          ],
        ]
      : [[{ text: '📊 Heute', callback_data: 'today' }]],
  });
}

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
    if (
      candidate.type === `tool-${ASK_USER_TOOL_NAME}` &&
      candidate.input &&
      typeof candidate.input === 'object'
    ) {
      return [
        {
          type: candidate.type,
          input: candidate.input,
          output: candidate.output,
          ...(typeof candidate.toolCallId === 'string' && {
            toolCallId: candidate.toolCallId,
          }),
          ...(typeof candidate.state === 'string' && {
            state: candidate.state,
          }),
        },
      ];
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
  return Boolean(
    await telegramQueueService.queueTelegramDelivery({
      userId,
      telegramChatId,
      content,
    })
  );
}

async function answerTelegramChat(
  userId: string,
  telegramChatId: string,
  input: TelegramChatInput
): Promise<void> {
  await sendTelegramTyping(telegramChatId).catch(() => undefined);
  try {
    const directWaterCommand = input.imageFileId
      ? null
      : parseDirectWaterLogCommand(input.text);
    if (directWaterCommand) {
      await answerDirectWaterLog(
        userId,
        telegramChatId,
        input.text,
        directWaterCommand,
        { source: 'telegram', deterministic: 'direct_water' },
        `update:${input.updateId}`
      );
      return;
    }
    const [history, activeSetting, user] = await Promise.all([
      chatService.getSparkyChatHistory(userId, userId),
      chatService.getActiveAiServiceSetting(userId, userId),
      userRepository.findUserById(userId),
    ]);
    if (!activeSetting?.id) {
      await telegramQueueService.queueTelegramDelivery({
        userId,
        telegramChatId,
        content:
          'In SparkyFitness ist noch kein aktiver KI-Anbieter ausgewählt. Öffne die Web-Einstellungen, wähle einen Anbieter und schreibe mir dann erneut.',
      });
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
        await telegramQueueService.queueTelegramDelivery({
          userId,
          telegramChatId,
          content:
            'Ich konnte das Foto nicht laden. Bitte sende es noch einmal als normales Bild und nicht als Datei.',
        });
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
          metadata: entry.metadata,
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
      toolCategories,
      { allowAskUser: !input.imageFileId }
    );
    await telegramQueueService.queueTelegramDelivery({
      userId,
      telegramChatId,
      content: result.content,
      buttons: [
        [
          { text: '💧 +250 ml', callback_data: 'water:250' },
          { text: '💧 +500 ml', callback_data: 'water:500' },
        ],
        [{ text: '📊 Heute', callback_data: 'today' }],
      ],
    });
  } catch (error) {
    log('error', `Telegram chat processing failed for user ${userId}:`, error);
    await telegramQueueService.queueTelegramDelivery({
      userId,
      telegramChatId,
      content:
        'Der Coach konnte diese Nachricht gerade nicht verarbeiten. Bitte versuche es später noch einmal.',
    });
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

const TODAY_BUTTONS = [
  [
    { text: '💧 +250 ml', callback_data: 'water:250' },
    { text: '💧 +500 ml', callback_data: 'water:500' },
  ],
];

async function answerTodayStatus(
  userId: string,
  telegramChatId: string,
  sourceText = '/today'
): Promise<void> {
  const language = await coachProfileRepository.getCoachLanguage(userId);
  const status = await coachContextService.getCoachTodayStatus(
    userId,
    language
  );
  const response = coachContextService.renderCoachTodayStatus(status, language);
  await saveDeterministicChatTurn(userId, sourceText, response, {
    source: 'telegram',
    deterministic: 'today',
  });
  await telegramQueueService.queueTelegramDelivery({
    userId,
    telegramChatId,
    content: response,
    buttons: TODAY_BUTTONS,
  });
}

async function transcribeTelegramVoice(
  userId: string,
  audio: TelegramAudio
): Promise<string> {
  const [setting, user, downloaded] = await Promise.all([
    chatService.getActiveAiServiceSettingForBackend(userId, userId),
    userRepository.findUserById(userId),
    downloadTelegramAudio(audio.file_id),
  ]);
  if (!setting) {
    throw new Error('No active AI service is configured for transcription.');
  }
  const result = await dispatchAudioTranscription({
    provider: {
      service_type: String(setting.service_type),
      api_key:
        typeof setting.api_key === 'string' ? setting.api_key : undefined,
      model_name:
        typeof setting.model_name === 'string' ? setting.model_name : undefined,
      custom_url:
        typeof setting.custom_url === 'string' ? setting.custom_url : undefined,
    },
    audio: downloaded.bytes,
    mimeType: downloaded.mimeType,
    languageHint: 'de',
    networkPolicy: deriveAiNetworkPolicy(setting, user?.role === 'admin'),
  });
  if (!result.ok) {
    throw new Error(`Voice transcription failed (${result.category}).`);
  }
  return result.text;
}

async function undoCoachAction(
  userId: string,
  telegramChatId: string,
  receiptId: string
): Promise<void> {
  const receipt = await coachActionRepository.claimUndo(userId, receiptId);
  if (!receipt) {
    await telegramQueueService.queueTelegramDelivery({
      userId,
      telegramChatId,
      content:
        'Diese Aktion kann nicht mehr rückgängig gemacht werden oder wurde bereits zurückgenommen.',
      buttons: [[{ text: '📊 Heute', callback_data: 'today' }]],
    });
    return;
  }
  try {
    if (receipt.resourceType !== 'water_log' || !receipt.resourceId) {
      throw new Error('Unsupported coach action receipt.');
    }
    await measurementService.deleteWaterIntakeLogEntry(
      userId,
      userId,
      receipt.resourceId
    );
    coachEventService.publish(userId, 'water');
    const language = await coachProfileRepository.getCoachLanguage(userId);
    const status = await coachContextService.getCoachTodayStatus(
      userId,
      language
    );
    await telegramQueueService.queueTelegramDelivery({
      userId,
      telegramChatId,
      content: `Rückgängig gemacht. Der Wasserstand für heute beträgt jetzt ${status.waterConsumedMl} ml.`,
      buttons: TODAY_BUTTONS,
    });
  } catch (error) {
    await coachActionRepository.restoreCompleted(userId, receiptId);
    throw error;
  }
}

async function handleCallbackQuery(
  callback: TelegramCallbackQuery,
  updateId: number
): Promise<void> {
  const message = callback.message;
  const data = callback.data?.trim();
  if (!message || !data) {
    await answerTelegramCallbackQuery(callback.id);
    return;
  }
  const telegramChatId = String(message.chat.id);
  const connection =
    await coachTelegramRepository.getConnectionByChatId(telegramChatId);
  if (
    !connection ||
    (connection.telegramUserId &&
      String(callback.from?.id ?? '') !== connection.telegramUserId)
  ) {
    await answerTelegramCallbackQuery(callback.id, 'Nicht autorisiert.');
    return;
  }
  await answerTelegramCallbackQuery(callback.id, 'Wird verarbeitet …');
  if (data === 'today') {
    await answerTodayStatus(connection.userId, telegramChatId, 'Heute-Button');
    return;
  }
  const waterMatch = data.match(/^water:(250|500)$/);
  if (waterMatch) {
    const amountMl = Number(waterMatch[1]);
    await answerDirectWaterLog(
      connection.userId,
      telegramChatId,
      `${amountMl} ml Wasser`,
      { amountMl, language: 'de' },
      { source: 'telegram', deterministic: 'quick_water' },
      `update:${updateId}`
    );
    return;
  }
  const undoMatch = data.match(/^undo:([0-9a-f-]{36})$/i);
  if (undoMatch) {
    await undoCoachAction(connection.userId, telegramChatId, undoMatch[1]);
  }
}

async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, Number(update.update_id));
    return;
  }
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
  const audio = message.voice ?? message.audio;
  if (!text && !photo && !audio) {
    await sendTelegramMessage(
      telegramChatId,
      'Ich kann Textnachrichten, Fotos und Sprachnachrichten verarbeiten.'
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

  const connection =
    await coachTelegramRepository.getConnectionByChatId(telegramChatId);
  if (!connection) {
    await sendTelegramMessage(
      telegramChatId,
      'Dieser Telegram-Chat ist nicht mit SparkyFitness verbunden. Erzeuge zuerst in den Coach-Einstellungen einen Verbindungslink.'
    );
    return;
  }
  const { userId } = connection;
  if (
    connection.telegramUserId &&
    String(message.from?.id ?? '') !== connection.telegramUserId
  ) {
    await sendTelegramMessage(
      telegramChatId,
      'Diese Nachricht ist nicht autorisiert.'
    );
    return;
  }

  if (text && /^\/(stop|disconnect)(?:@\w+)?$/i.test(text)) {
    await coachTelegramRepository.disconnectChat(telegramChatId);
    await sendTelegramMessage(
      telegramChatId,
      'Die Telegram-Verbindung wurde getrennt. Deine Daten und dein Chatverlauf bleiben in SparkyFitness erhalten.'
    );
    return;
  }

  if (text && /^\/(today|heute|status)(?:@\w+)?$/i.test(text)) {
    await answerTodayStatus(userId, telegramChatId, text);
    return;
  }

  let effectiveText = text || caption;
  if (audio) {
    try {
      effectiveText = await transcribeTelegramVoice(userId, audio);
    } catch (error) {
      log(
        'error',
        `Telegram voice transcription failed for user ${userId}:`,
        error
      );
      await telegramQueueService.queueTelegramDelivery({
        userId,
        telegramChatId,
        content:
          'Ich konnte die Sprachnachricht nicht transkribieren. Dafür muss der aktive KI-Anbieter Audio-Transkription unterstützen (OpenAI, Groq, kompatibler OpenAI-Endpunkt oder Google).',
      });
      return;
    }
  }

  await answerTelegramChat(userId, telegramChatId, {
    text:
      effectiveText ||
      'Analysiere dieses Foto und füge das erkennbare Lebensmittel oder Gericht meinem heutigen Ernährungstagebuch hinzu.',
    imageFileId: photo?.file_id,
    updateId: Number(updateId),
  });
}

export default {
  getConnectionStatus,
  createLink,
  disconnect,
  sendProactiveCoachMessage,
  handleTelegramUpdate,
};
