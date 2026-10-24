import { isReadOnlyApiKeyPermissions } from '@workspace/shared';
import { getApiKeyPermissions } from '../models/apiKeyRepository.js';

/**
 * POST endpoints a read-only API key may still call. They do not change the
 * user's data: /mcp filters its own tools per action (see ai/mcp/toolAccess.ts),
 * and the other two only send the request to the user's AI provider.
 */
const READ_ONLY_POST_ALLOWLIST = new Set([
  '/mcp',
  '/api/ai/convert-unit',
  '/api/foods/scan-label',
]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizePath(originalUrl: string): string {
  const path = originalUrl.split('?')[0] ?? '';
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/** Whether a read-only API key may make this request. */
export function isRequestAllowedForReadOnlyKey(
  method: string | undefined,
  originalUrl: string
): boolean {
  const upper = (method ?? 'GET').toUpperCase();
  if (SAFE_METHODS.has(upper)) return true;
  if (upper !== 'POST') return false;
  return READ_ONLY_POST_ALLOWLIST.has(normalizePath(originalUrl));
}

/** Whether a request method can change data (anything but GET/HEAD/OPTIONS). */
export function isMutatingMethod(method: string | undefined): boolean {
  return !SAFE_METHODS.has((method ?? 'GET').toUpperCase());
}

/**
 * Resolves the scope of the API key behind an API-key session. Better Auth's
 * api-key plugin builds that session with `session.id` set to the key's id.
 *
 * Fails closed: a session without a key id, or a key the user cannot see, is
 * treated as read-only rather than as full access.
 */
export async function isApiKeyReadOnly(
  userId: string,
  apiKeyId: string | undefined
): Promise<boolean> {
  if (!apiKeyId) return true;
  const permissions = await getApiKeyPermissions(userId, apiKeyId);
  if (permissions === undefined) return true;
  return isReadOnlyApiKeyPermissions(permissions);
}
