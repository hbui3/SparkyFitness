import type { IncomingHttpHeaders } from 'node:http';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../auth.js';
import { isApiKeyReadOnly, isMutatingMethod } from '../utils/apiKeyScope.js';

interface AuthRouteRequest {
  method?: string;
  headers: IncomingHttpHeaders;
}

/**
 * True when a read-only API key sends a mutating request to Better Auth's own
 * routes (/api/auth/*). Those are handled by Better Auth directly and never pass
 * through `authenticate`, so without this a read-only key could, for example,
 * mint itself a new full-access key via /api/auth/api-key/create.
 *
 * Call after bridgeBearerAuthHeader, so a Bearer API key has become x-api-key.
 */
export async function isReadOnlyApiKeyAuthMutation(
  req: AuthRouteRequest
): Promise<boolean> {
  if (!isMutatingMethod(req.method)) return false;
  if (typeof req.headers['x-api-key'] !== 'string') return false;
  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
  } catch {
    // Invalid, disabled, expired or rate-limited key: Better Auth's handler
    // rejects the request itself with the matching error.
    return false;
  }
  if (!session?.user) return false;
  return isApiKeyReadOnly(session.user.id, session.session?.id);
}
