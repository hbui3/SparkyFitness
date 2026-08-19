import { log } from '../config/logging.js';
import { getTelegramRuntimeConfig } from './telegramConfigService.js';

interface TelegramApiEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  parameters?: { retry_after?: number };
}

interface TelegramBotIdentity {
  username?: string;
}

interface TelegramRemoteFile {
  file_path?: string;
  file_size?: number;
}

export interface TelegramDownloadedImage {
  dataUrl: string;
  mimeType: string;
}

export interface TelegramDownloadedAudio {
  bytes: Buffer;
  mimeType: string;
}

export interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

const MAX_TELEGRAM_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TELEGRAM_AUDIO_BYTES = 20 * 1024 * 1024;
const TELEGRAM_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

let cachedBotIdentity: { token: string; username: string | null } | undefined;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getTelegramBotToken(): Promise<string | null> {
  return (await getTelegramRuntimeConfig()).botToken;
}

export async function getTelegramWebhookSecret(): Promise<string | null> {
  return (await getTelegramRuntimeConfig()).webhookSecret;
}

export async function isTelegramConfigured(): Promise<boolean> {
  const config = await getTelegramRuntimeConfig();
  return Boolean(config.botToken && config.webhookSecret);
}

async function callTelegramApi<T>(
  method: string,
  body?: Record<string, unknown>,
  explicitToken?: string
): Promise<T> {
  const token = explicitToken ?? (await getTelegramBotToken());
  if (!token) throw new Error('Telegram bot token is not configured.');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      if (attempt < 3) {
        await delay(500 * 2 ** attempt);
        continue;
      }
      // Fetch errors can include the request URL. Do not let the bot token from
      // that URL escape into caller logs.
      throw new Error(`Telegram API ${method} request failed.`);
    }

    let envelope: TelegramApiEnvelope<T> | null = null;
    try {
      envelope = (await response.json()) as TelegramApiEnvelope<T>;
    } catch {
      // Telegram normally returns JSON even for errors. A non-JSON response is
      // still retryable when the upstream status is transient.
    }
    if (attempt < 3 && (response.status === 429 || response.status >= 500)) {
      const retryMs = envelope?.parameters?.retry_after
        ? envelope.parameters.retry_after * 1_000
        : 500 * 2 ** attempt;
      await delay(Math.min(retryMs, 15_000));
      continue;
    }
    if (!response.ok) {
      throw new Error(
        `Telegram API ${method} failed with status ${response.status}.`
      );
    }
    if (!envelope?.ok || envelope.result === undefined) {
      throw new Error(
        `Telegram API ${method} rejected the request: ${envelope?.description ?? 'unknown error'}.`
      );
    }
    return envelope.result;
  }
  throw new Error(`Telegram API ${method} request failed.`);
}

export async function getTelegramBotUsername(): Promise<string | null> {
  const config = await getTelegramRuntimeConfig();
  if (!config.botToken || !config.webhookSecret) return null;
  if (cachedBotIdentity?.token === config.botToken) {
    return cachedBotIdentity.username;
  }
  const bot = await callTelegramApi<TelegramBotIdentity>(
    'getMe',
    undefined,
    config.botToken
  );
  const username = bot.username?.trim() || null;
  cachedBotIdentity = { token: config.botToken, username };
  return username;
}

export async function validateTelegramBotToken(
  botToken: string
): Promise<string> {
  const bot = await callTelegramApi<TelegramBotIdentity>(
    'getMe',
    undefined,
    botToken
  );
  const username = bot.username?.trim();
  if (!username) throw new Error('Telegram bot has no username.');
  return username;
}

function telegramPlainText(value: string): string {
  return value
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .trim();
}

function splitTelegramText(value: string): string[] {
  const text = telegramPlainText(value);
  const characters = Array.from(text);
  if (characters.length <= 4_000) return [text];
  const chunks: string[] = [];
  let remaining = characters;
  while (remaining.length > 4_000) {
    const candidate = remaining.slice(0, 4_000).join('');
    const splitAt = Math.max(
      candidate.lastIndexOf('\n\n'),
      candidate.lastIndexOf('\n')
    );
    const end = splitAt > 2_500 ? splitAt : 4_000;
    chunks.push(remaining.slice(0, end).join('').trim());
    remaining = Array.from(remaining.slice(end).join('').trim());
  }
  if (remaining.length > 0) chunks.push(remaining.join(''));
  return chunks;
}

export async function sendTelegramMessage(
  telegramChatId: string,
  text: string,
  buttons: TelegramInlineButton[][] = []
): Promise<void> {
  const chunks = splitTelegramText(text);
  for (let index = 0; index < chunks.length; index += 1) {
    await callTelegramApi<unknown>('sendMessage', {
      chat_id: telegramChatId,
      text: chunks[index],
      ...(buttons.length > 0 && index === chunks.length - 1
        ? { reply_markup: { inline_keyboard: buttons } }
        : {}),
    });
  }
}

export async function answerTelegramCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<void> {
  await callTelegramApi<unknown>('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text: text.slice(0, 200) } : {}),
  });
}

export async function sendTelegramTyping(
  telegramChatId: string
): Promise<void> {
  await callTelegramApi<unknown>('sendChatAction', {
    chat_id: telegramChatId,
    action: 'typing',
  });
}

function inferTelegramImageMimeType(
  contentType: string | null,
  filePath: string
): string | null {
  const normalizedContentType = contentType
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (
    normalizedContentType &&
    TELEGRAM_IMAGE_MIME_TYPES.has(normalizedContentType)
  ) {
    return normalizedContentType;
  }
  const extension = filePath.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return null;
}

/** Downloads a Telegram-hosted photo without exposing the bot token upstream. */
export async function downloadTelegramImage(
  fileId: string
): Promise<TelegramDownloadedImage> {
  const token = await getTelegramBotToken();
  if (!token) throw new Error('Telegram bot token is not configured.');

  const remoteFile = await callTelegramApi<TelegramRemoteFile>('getFile', {
    file_id: fileId,
  });
  const filePath = remoteFile.file_path?.trim();
  if (!filePath) throw new Error('Telegram did not return an image file path.');
  if (
    remoteFile.file_size !== undefined &&
    remoteFile.file_size > MAX_TELEGRAM_IMAGE_BYTES
  ) {
    throw new Error('Telegram image exceeds the 10 MB processing limit.');
  }

  const pathSegments = filePath.split('/').filter(Boolean);
  if (
    pathSegments.length === 0 ||
    pathSegments.some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error('Telegram returned an invalid image file path.');
  }
  const safePath = pathSegments.map(encodeURIComponent).join('/');
  let response: Response;
  try {
    response = await fetch(
      `https://api.telegram.org/file/bot${token}/${safePath}`,
      {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      }
    );
  } catch {
    // As above, keep the token-bearing download URL out of logs.
    throw new Error('Telegram image download request failed.');
  }
  if (!response.ok) {
    throw new Error(
      `Telegram image download failed with status ${response.status}.`
    );
  }

  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_TELEGRAM_IMAGE_BYTES) {
    throw new Error('Telegram image exceeds the 10 MB processing limit.');
  }
  const mimeType = inferTelegramImageMimeType(
    response.headers.get('content-type'),
    filePath
  );
  if (!mimeType)
    throw new Error('Telegram returned an unsupported image type.');

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error('Telegram returned an empty image.');
  if (bytes.length > MAX_TELEGRAM_IMAGE_BYTES) {
    throw new Error('Telegram image exceeds the 10 MB processing limit.');
  }
  return {
    dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
    mimeType,
  };
}

function inferTelegramAudioMimeType(
  contentType: string | null,
  filePath: string
): string | null {
  const declared = contentType?.split(';', 1)[0].trim().toLowerCase();
  if (
    declared &&
    new Set([
      'audio/ogg',
      'audio/mpeg',
      'audio/mp4',
      'audio/webm',
      'audio/wav',
      'audio/x-wav',
    ]).has(declared)
  ) {
    return declared;
  }
  const extension = filePath.split('.').pop()?.toLowerCase();
  if (extension === 'oga' || extension === 'ogg' || extension === 'opus')
    return 'audio/ogg';
  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'm4a' || extension === 'mp4') return 'audio/mp4';
  if (extension === 'webm') return 'audio/webm';
  if (extension === 'wav') return 'audio/wav';
  return null;
}

export async function downloadTelegramAudio(
  fileId: string
): Promise<TelegramDownloadedAudio> {
  const token = await getTelegramBotToken();
  if (!token) throw new Error('Telegram bot token is not configured.');
  const remoteFile = await callTelegramApi<TelegramRemoteFile>('getFile', {
    file_id: fileId,
  });
  const filePath = remoteFile.file_path?.trim();
  if (!filePath) throw new Error('Telegram did not return an audio file path.');
  if (
    remoteFile.file_size !== undefined &&
    remoteFile.file_size > MAX_TELEGRAM_AUDIO_BYTES
  ) {
    throw new Error('Telegram audio exceeds the 20 MB processing limit.');
  }
  const pathSegments = filePath.split('/').filter(Boolean);
  if (
    pathSegments.length === 0 ||
    pathSegments.some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error('Telegram returned an invalid audio file path.');
  }
  const safePath = pathSegments.map(encodeURIComponent).join('/');
  let response: Response;
  try {
    response = await fetch(
      `https://api.telegram.org/file/bot${token}/${safePath}`,
      {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      }
    );
  } catch {
    throw new Error('Telegram audio download request failed.');
  }
  if (!response.ok) {
    throw new Error(
      `Telegram audio download failed with status ${response.status}.`
    );
  }
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_TELEGRAM_AUDIO_BYTES) {
    throw new Error('Telegram audio exceeds the 20 MB processing limit.');
  }
  const mimeType = inferTelegramAudioMimeType(
    response.headers.get('content-type'),
    filePath
  );
  if (!mimeType)
    throw new Error('Telegram returned an unsupported audio type.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error('Telegram returned empty audio.');
  if (bytes.length > MAX_TELEGRAM_AUDIO_BYTES) {
    throw new Error('Telegram audio exceeds the 20 MB processing limit.');
  }
  return { bytes, mimeType };
}

export function getTelegramWebhookUrl(): string | null {
  const baseUrl = (
    process.env.SPARKY_FITNESS_TELEGRAM_WEBHOOK_URL ||
    process.env.SPARKY_FITNESS_FRONTEND_URL ||
    ''
  )
    .trim()
    .replace(/\/$/, '');
  if (!baseUrl) return null;
  return baseUrl.endsWith('/api/telegram/webhook')
    ? baseUrl
    : `${baseUrl}/api/telegram/webhook`;
}

export async function configureTelegramWebhook(): Promise<void> {
  const config = await getTelegramRuntimeConfig(true);
  if (!config.botToken || !config.webhookSecret) {
    log('info', 'Telegram coach integration is not configured.');
    return;
  }
  const webhookUrl = getTelegramWebhookUrl();
  if (!webhookUrl?.startsWith('https://')) {
    log('warn', 'Telegram webhook requires a public HTTPS URL; setup skipped.');
    return;
  }
  await callTelegramApi<boolean>(
    'setWebhook',
    {
      url: webhookUrl,
      secret_token: config.webhookSecret,
      allowed_updates: ['message', 'callback_query'],
      max_connections: 1,
    },
    config.botToken
  );
  log('info', `Telegram coach webhook configured at ${webhookUrl}.`);
}

export function resetTelegramApiCache(): void {
  cachedBotIdentity = undefined;
}
