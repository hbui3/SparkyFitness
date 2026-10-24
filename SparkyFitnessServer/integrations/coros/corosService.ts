import crypto from 'crypto';
import axios from 'axios';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getSystemClient } from '../../db/poolManager.js';
import { encrypt, decrypt, ENCRYPTION_KEY } from '../../security/encryption.js';
import { log } from '../../config/logging.js';
import { logRawResponse } from '../../utils/diagnosticLogger.js';
import { claimOAuthState, persistOAuthState } from '../../utils/oauthState.js';
import { withProviderTokenLock } from '../../models/externalProviderRepository.js';
import {
  COROS_PROVIDER_TYPE,
  COROS_SCOPE,
  resolveCorosMcpUrl,
  corosIssuerFromMcpUrl,
} from './corosConstants.js';
import type { CorosToolCallResult } from './corosMcpText.js';

export class CorosRedirectUriError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CorosRedirectUriError';
  }
}

export class CorosReauthRequiredError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CorosReauthRequiredError';
  }
}

export interface CorosTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
}

export interface CorosRegistrationResponse {
  client_id: string;
  client_name?: string;
  redirect_uris?: string[];
}

export interface CorosStatusResult {
  connected: boolean;
  isActive: boolean;
  lastSyncAt: Date | null;
  tokenExpiresAt: Date | null;
  externalUserId: string | null;
}

/**
 * Returns the canonical COROS OAuth callback redirect URI.
 */
export function getCorosRedirectUri(baseUrl?: string): string {
  const origin = (
    baseUrl ||
    process.env.SPARKY_FITNESS_FRONTEND_URL ||
    'http://localhost:8080'
  ).replace(/\/$/, '');
  return `${origin}/coros/callback`;
}

/**
 * Derives a deterministic PKCE S256 code verifier from the OAuth state nonce and server key.
 */
export function derivePkceVerifier(state: string): string {
  return crypto
    .createHmac('sha256', ENCRYPTION_KEY)
    .update(`coros-pkce:${state}`)
    .digest('base64url');
}

/**
 * Derives the PKCE S256 challenge from the verifier.
 */
export function derivePkceChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Registers a public OAuth 2.0 client via COROS Dynamic Client Registration (DCR).
 */
export async function registerClient(
  issuer: string,
  redirectUri: string
): Promise<string> {
  const registerUrl = `${issuer}/connect/register`;
  try {
    const response = await axios.post<CorosRegistrationResponse>(
      registerUrl,
      {
        client_name: 'SparkyFitness',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: COROS_SCOPE,
        token_endpoint_auth_method: 'none',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      }
    );

    if (response.data && response.data.client_id) {
      return response.data.client_id;
    }
    throw new Error('DCR response did not contain a client_id');
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response) {
      const errData = error.response.data as
        { error?: string; error_description?: string } | undefined;
      if (errData?.error === 'invalid_redirect_uri') {
        throw new CorosRedirectUriError(
          'COROS requires an HTTPS address (or localhost). Set SPARKY_FITNESS_FRONTEND_URL to an https:// URL and try again.',
          { cause: error }
        );
      }
      throw new Error(
        `Failed to register client with COROS: ${errData?.error_description || errData?.error || error.message}`,
        { cause: error }
      );
    }
    throw error;
  }
}

/**
 * Generates the COROS OAuth 2.0 authorization URL for a user.
 */
export async function getAuthorizationUrl(
  userId: string,
  redirectUri: string,
  providerId?: string | null
): Promise<string> {
  const client = await getSystemClient();
  try {
    // Find provider row
    let rowQuery =
      'SELECT id, base_url, provider_type FROM external_data_providers WHERE user_id = $1 AND provider_type = $2';
    const queryParams: (string | null)[] = [userId, COROS_PROVIDER_TYPE];
    if (providerId) {
      rowQuery += ' AND id = $3';
      queryParams.push(providerId);
    }
    rowQuery += ' ORDER BY created_at DESC LIMIT 1';

    const rowRes = await client.query(rowQuery, queryParams);
    const row = rowRes.rows[0] as
      | { id: string; base_url: string | null; provider_type: string }
      | undefined;
    if (!row) {
      throw new Error('COROS provider record not found for user');
    }

    const mcpUrl = resolveCorosMcpUrl(row.base_url);
    const issuer = corosIssuerFromMcpUrl(mcpUrl);

    // Register dynamic client to obtain clientId
    const clientId = await registerClient(issuer, redirectUri);
    const encryptedAppId = await encrypt(clientId, ENCRYPTION_KEY);

    await client.query(
      `UPDATE external_data_providers
       SET encrypted_app_id = $1, app_id_iv = $2, app_id_tag = $3, base_url = $4, updated_at = NOW()
       WHERE id = $5`,
      [
        encryptedAppId.encryptedText,
        encryptedAppId.iv,
        encryptedAppId.tag,
        mcpUrl,
        row.id,
      ]
    );

    const { state } = await persistOAuthState(client, {
      userId,
      providerType: COROS_PROVIDER_TYPE,
      providerId: row.id,
    });

    const verifier = derivePkceVerifier(state);
    const challenge = derivePkceChallenge(verifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: COROS_SCOPE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: mcpUrl,
      state,
    });

    return `${issuer}/oauth2/authorize?${params.toString()}`;
  } finally {
    client.release();
  }
}

/**
 * Exchanges the OAuth authorization code for tokens and persists them.
 */
export async function exchangeCodeForTokens(
  state: unknown,
  code: string,
  redirectUri: string,
  actorUserId: string
): Promise<{ success: boolean; ownerUserId: string }> {
  const client = await getSystemClient();
  try {
    const claimed = await claimOAuthState(client, {
      state,
      providerType: COROS_PROVIDER_TYPE,
      actorUserId,
    });

    const {
      id: providerId,
      user_id: ownerUserId,
      encrypted_app_id,
      app_id_iv,
      app_id_tag,
    } = claimed;

    if (!encrypted_app_id || !app_id_iv || !app_id_tag) {
      throw new Error('Missing encrypted client ID in provider record');
    }

    const clientId = await decrypt(
      encrypted_app_id,
      app_id_iv,
      app_id_tag,
      ENCRYPTION_KEY
    );

    const stateStr = String(state);
    const verifier = derivePkceVerifier(stateStr);

    const rowRes = await client.query(
      'SELECT base_url FROM external_data_providers WHERE id = $1',
      [providerId]
    );
    const mcpUrl = resolveCorosMcpUrl(
      (rowRes.rows[0] as { base_url?: string | null } | undefined)?.base_url
    );
    const issuer = corosIssuerFromMcpUrl(mcpUrl);

    const tokenUrl = `${issuer}/oauth2/token`;
    const bodyParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId || '',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });

    const tokenResponse = await axios.post<CorosTokenResponse>(
      tokenUrl,
      bodyParams.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
      }
    );

    const { access_token, refresh_token, expires_in, id_token } =
      tokenResponse.data;

    if (!access_token || !refresh_token) {
      throw new Error(
        'COROS token response missing access_token or refresh_token'
      );
    }

    // Extract sub claim as external_user_id
    let externalUserId: string | null = null;
    if (id_token) {
      try {
        const payloadBase64 = id_token.split('.')[1];
        if (payloadBase64) {
          const payloadJson = Buffer.from(payloadBase64, 'base64url').toString(
            'utf8'
          );
          const payload = JSON.parse(payloadJson) as { sub?: string };
          if (payload.sub) externalUserId = payload.sub;
        }
      } catch (e) {
        log('warn', `Failed to parse sub from id_token: ${e}`);
      }
    }
    if (!externalUserId && access_token) {
      try {
        const payloadBase64 = access_token.split('.')[1];
        if (payloadBase64) {
          const payloadJson = Buffer.from(payloadBase64, 'base64url').toString(
            'utf8'
          );
          const payload = JSON.parse(payloadJson) as { sub?: string };
          if (payload.sub) externalUserId = payload.sub;
        }
      } catch (e) {
        log('warn', `Failed to parse sub from access_token: ${e}`);
      }
    }

    const encryptedAccess = await encrypt(access_token, ENCRYPTION_KEY);
    const encryptedRefresh = await encrypt(refresh_token, ENCRYPTION_KEY);
    const expiresAt = new Date(Date.now() + (expires_in ?? 2591999) * 1000);

    await client.query(
      `UPDATE external_data_providers
       SET encrypted_access_token = $1, access_token_iv = $2, access_token_tag = $3,
           encrypted_refresh_token = $4, refresh_token_iv = $5, refresh_token_tag = $6,
           token_expires_at = $7, external_user_id = $8, oauth_state = NULL,
           is_active = TRUE, updated_at = NOW()
       WHERE id = $9`,
      [
        encryptedAccess.encryptedText,
        encryptedAccess.iv,
        encryptedAccess.tag,
        encryptedRefresh.encryptedText,
        encryptedRefresh.iv,
        encryptedRefresh.tag,
        expiresAt,
        externalUserId,
        providerId,
      ]
    );

    return { success: true, ownerUserId };
  } finally {
    client.release();
  }
}

const inFlightRefreshes = new Map<string, Promise<string>>();

function isAuthError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof CorosReauthRequiredError) return true;
  const anyErr = err as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  if (
    anyErr.code === 401 ||
    anyErr.code === '401' ||
    anyErr.status === 401 ||
    anyErr.response?.status === 401
  ) {
    return true;
  }
  const str = String(err);
  return (
    /\b401\b/.test(str) ||
    str.includes('Unauthorized') ||
    str.includes('invalid_token') ||
    str.includes('invalid_grant')
  );
}

/**
 * Refreshes the OAuth access token for a given provider, updating the rotated refresh token.
 * Uses an in-flight promise map per providerId to serialize concurrent refreshes.
 */
export async function refreshAccessToken(
  userId: string,
  providerId: string
): Promise<string> {
  const existing = inFlightRefreshes.get(providerId);
  if (existing) {
    return existing;
  }

  const refreshPromise = (async () => {
    const client = await getSystemClient();
    try {
      return await withProviderTokenLock(client, async () => {
        const rowRes = await client.query(
          `SELECT id, base_url, encrypted_app_id, app_id_iv, app_id_tag,
                encrypted_refresh_token, refresh_token_iv, refresh_token_tag
         FROM external_data_providers
         WHERE id = $1 AND user_id = $2
         FOR UPDATE`,
          [providerId, userId]
        );
        const row = rowRes.rows[0] as
          | {
              id: string;
              base_url: string | null;
              encrypted_app_id: string | null;
              app_id_iv: string | null;
              app_id_tag: string | null;
              encrypted_refresh_token: string | null;
              refresh_token_iv: string | null;
              refresh_token_tag: string | null;
            }
          | undefined;

        if (!row) {
          throw new Error(
            `Provider ${providerId} not found for user ${userId}`
          );
        }

        const mcpUrl = resolveCorosMcpUrl(row.base_url);
        const issuer = corosIssuerFromMcpUrl(mcpUrl);

        let clientId: string;
        if (row.encrypted_app_id && row.app_id_iv && row.app_id_tag) {
          clientId =
            (await decrypt(
              row.encrypted_app_id,
              row.app_id_iv,
              row.app_id_tag,
              ENCRYPTION_KEY
            )) || '';
        } else {
          // Re-register client
          const redirectUri = getCorosRedirectUri();
          clientId = await registerClient(issuer, redirectUri);
          const enc = await encrypt(clientId, ENCRYPTION_KEY);
          await client.query(
            'UPDATE external_data_providers SET encrypted_app_id = $1, app_id_iv = $2, app_id_tag = $3 WHERE id = $4',
            [enc.encryptedText, enc.iv, enc.tag, providerId]
          );
        }

        if (
          !row.encrypted_refresh_token ||
          !row.refresh_token_iv ||
          !row.refresh_token_tag
        ) {
          throw new CorosReauthRequiredError(
            'No refresh token available. Re-authorization required.'
          );
        }

        const refreshToken =
          (await decrypt(
            row.encrypted_refresh_token,
            row.refresh_token_iv,
            row.refresh_token_tag,
            ENCRYPTION_KEY
          )) || '';

        const tokenUrl = `${issuer}/oauth2/token`;
        const bodyParams = new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: refreshToken,
        });

        let tokenResponse;
        try {
          tokenResponse = await axios.post<CorosTokenResponse>(
            tokenUrl,
            bodyParams.toString(),
            {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
              },
            }
          );
        } catch (error: unknown) {
          if (axios.isAxiosError(error) && error.response) {
            const status = error.response.status;
            const errData = error.response.data as
              { error?: string } | undefined;
            const isDefinitiveAuthError =
              status === 401 ||
              errData?.error === 'invalid_grant' ||
              errData?.error === 'invalid_token' ||
              errData?.error === 'invalid_client';

            if (isDefinitiveAuthError) {
              log(
                'warn',
                `COROS token refresh rejected for user ${userId}: ${errData?.error || status}`
              );
              // Clear token columns but preserve row
              await client.query(
                `UPDATE external_data_providers
               SET encrypted_access_token = NULL, access_token_iv = NULL, access_token_tag = NULL,
                   encrypted_refresh_token = NULL, refresh_token_iv = NULL, refresh_token_tag = NULL,
                   token_expires_at = NULL, external_user_id = NULL, updated_at = NOW()
               WHERE id = $1`,
                [providerId]
              );
              throw new CorosReauthRequiredError(
                'Your COROS connection has expired. Click Connect to sign in again.'
              );
            }
          }
          throw error;
        }

        const {
          access_token,
          refresh_token: newRefreshToken,
          expires_in,
        } = tokenResponse.data;
        if (!access_token) {
          throw new Error(
            'COROS refresh response did not include access_token'
          );
        }

        const encAccess = await encrypt(access_token, ENCRYPTION_KEY);
        const encRefresh = newRefreshToken
          ? await encrypt(newRefreshToken, ENCRYPTION_KEY)
          : null;
        const expiresAt = new Date(Date.now() + (expires_in ?? 2591999) * 1000);

        if (encRefresh) {
          await client.query(
            `UPDATE external_data_providers
           SET encrypted_access_token = $1, access_token_iv = $2, access_token_tag = $3,
               encrypted_refresh_token = $4, refresh_token_iv = $5, refresh_token_tag = $6,
               token_expires_at = $7, updated_at = NOW()
           WHERE id = $8`,
            [
              encAccess.encryptedText,
              encAccess.iv,
              encAccess.tag,
              encRefresh.encryptedText,
              encRefresh.iv,
              encRefresh.tag,
              expiresAt,
              providerId,
            ]
          );
        } else {
          await client.query(
            `UPDATE external_data_providers
           SET encrypted_access_token = $1, access_token_iv = $2, access_token_tag = $3,
               token_expires_at = $4, updated_at = NOW()
           WHERE id = $5`,
            [
              encAccess.encryptedText,
              encAccess.iv,
              encAccess.tag,
              expiresAt,
              providerId,
            ]
          );
        }

        return access_token;
      });
    } finally {
      client.release();
    }
  })();

  inFlightRefreshes.set(providerId, refreshPromise);
  try {
    return await refreshPromise;
  } finally {
    inFlightRefreshes.delete(providerId);
  }
}

/**
 * Retrieves a valid, unexpired access token, proactively refreshing if older than 7 days or nearing expiry.
 */
export async function getValidAccessToken(
  userId: string,
  providerId: string
): Promise<{ token: string; mcpUrl: string; externalUserId: string }> {
  const client = await getSystemClient();
  let row:
    | {
        base_url: string | null;
        encrypted_access_token: string | null;
        access_token_iv: string | null;
        access_token_tag: string | null;
        token_expires_at: Date | null;
        external_user_id: string | null;
      }
    | undefined;

  try {
    const rowRes = await client.query(
      `SELECT base_url, encrypted_access_token, access_token_iv, access_token_tag,
              token_expires_at, external_user_id
       FROM external_data_providers
       WHERE id = $1 AND user_id = $2`,
      [providerId, userId]
    );
    row = rowRes.rows[0] as typeof row;
  } finally {
    client.release();
  }

  if (!row || !row.encrypted_access_token) {
    throw new CorosReauthRequiredError(
      'COROS account is not connected. Click Connect to authorize.'
    );
  }

  const mcpUrl = resolveCorosMcpUrl(row.base_url);
  const now = Date.now();
  const expiresAtMs = row.token_expires_at
    ? new Date(row.token_expires_at).getTime()
    : 0;
  // 30 days total lifetime. Refresh if missing, < 5 minutes away, or issued > 7 days ago (expiresAt - 23d < now)
  const isExpiringSoon = !expiresAtMs || expiresAtMs - now < 5 * 60 * 1000;
  const isOlderThan7Days = expiresAtMs - 23 * 24 * 3600 * 1000 < now;

  let accessToken: string;
  if (isExpiringSoon || isOlderThan7Days) {
    log('info', `Proactively refreshing COROS access token for user ${userId}`);
    accessToken = await refreshAccessToken(userId, providerId);
  } else {
    accessToken =
      (await decrypt(
        row.encrypted_access_token,
        row.access_token_iv!,
        row.access_token_tag!,
        ENCRYPTION_KEY
      )) || '';
  }

  return {
    token: accessToken,
    mcpUrl,
    externalUserId: row.external_user_id || '',
  };
}

/**
 * Creates an authenticated StreamableHTTP MCP client to execute COROS tool calls.
 */
export async function withCorosMcp<T>(
  userId: string,
  providerId: string,
  fn: (
    call: (
      toolName: string,
      args: Record<string, unknown>,
      captureKey?: string
    ) => Promise<CorosToolCallResult>
  ) => Promise<T>
): Promise<T> {
  const { token: initialToken, mcpUrl } = await getValidAccessToken(
    userId,
    providerId
  );
  let token = initialToken;

  let client = new Client(
    { name: 'SparkyFitness', version: '1.0.0' },
    { capabilities: {} }
  );

  let transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  try {
    await client.connect(transport);
  } catch (err: unknown) {
    if (isAuthError(err)) {
      log(
        'info',
        'COROS connect returned auth error. Refreshing token and retrying connect...'
      );
      try {
        token = await refreshAccessToken(userId, providerId);
        transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
          requestInit: {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        });
        client = new Client(
          { name: 'SparkyFitness', version: '1.0.0' },
          { capabilities: {} }
        );
        await client.connect(transport);
      } catch (retryErr) {
        if (
          isAuthError(retryErr) ||
          retryErr instanceof CorosReauthRequiredError
        ) {
          throw new CorosReauthRequiredError(
            'Your COROS connection has expired. Click Connect to sign in again.'
          );
        }
        throw retryErr;
      }
    } else {
      throw err;
    }
  }

  try {
    const callTool = async (
      toolName: string,
      args: Record<string, unknown>,
      captureKey?: string
    ): Promise<CorosToolCallResult> => {
      let result: CorosToolCallResult;
      try {
        result = (await client.callTool({
          name: toolName,
          arguments: args,
        })) as CorosToolCallResult;
      } catch (err: unknown) {
        // Retry once on auth error
        if (isAuthError(err)) {
          log(
            'info',
            `COROS MCP returned auth error. Refreshing token and retrying ${toolName}...`
          );
          let newToken: string;
          try {
            newToken = await refreshAccessToken(userId, providerId);
          } catch (refreshErr) {
            if (
              isAuthError(refreshErr) ||
              refreshErr instanceof CorosReauthRequiredError
            ) {
              throw new CorosReauthRequiredError(
                'Your COROS connection has expired. Click Connect to sign in again.'
              );
            }
            throw refreshErr;
          }

          const retryTransport = new StreamableHTTPClientTransport(
            new URL(mcpUrl),
            {
              requestInit: {
                headers: {
                  Authorization: `Bearer ${newToken}`,
                },
              },
            }
          );
          const retryClient = new Client(
            { name: 'SparkyFitness', version: '1.0.0' },
            { capabilities: {} }
          );
          try {
            await retryClient.connect(retryTransport);
            result = (await retryClient.callTool({
              name: toolName,
              arguments: args,
            })) as CorosToolCallResult;
          } catch (retryCallErr) {
            if (isAuthError(retryCallErr)) {
              throw new CorosReauthRequiredError(
                'Your COROS connection has expired. Click Connect to sign in again.'
              );
            }
            throw retryCallErr;
          } finally {
            await retryTransport.close().catch(() => {});
          }
        } else {
          throw err;
        }
      }

      if (captureKey) {
        logRawResponse('coros_mcp', captureKey, result);
      }

      return result;
    };

    return await fn(callTool);
  } finally {
    await transport.close().catch(() => {});
  }
}

/**
 * Returns connection and sync status for the COROS integration.
 */
export async function getStatus(
  userId: string,
  providerId?: string | null
): Promise<CorosStatusResult> {
  const client = await getSystemClient();
  try {
    let query =
      'SELECT id, is_active, last_sync_at, token_expires_at, external_user_id, encrypted_access_token FROM external_data_providers WHERE user_id = $1 AND provider_type = $2';
    const params: (string | null)[] = [userId, COROS_PROVIDER_TYPE];
    if (providerId) {
      query += ' AND id = $3';
      params.push(providerId);
    }
    query += ' ORDER BY created_at DESC LIMIT 1';

    const res = await client.query(query, params);
    const row = res.rows[0] as
      | {
          id: string;
          is_active: boolean;
          last_sync_at: Date | null;
          token_expires_at: Date | null;
          external_user_id: string | null;
          encrypted_access_token: string | null;
        }
      | undefined;

    if (!row) {
      return {
        connected: false,
        isActive: false,
        lastSyncAt: null,
        tokenExpiresAt: null,
        externalUserId: null,
      };
    }

    const connected = !!row.external_user_id && !!row.encrypted_access_token;
    return {
      connected,
      isActive: Boolean(row.is_active),
      lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at) : null,
      tokenExpiresAt: row.token_expires_at
        ? new Date(row.token_expires_at)
        : null,
      externalUserId: row.external_user_id,
    };
  } finally {
    client.release();
  }
}

/**
 * Disconnects the COROS provider, revoking tokens best-effort and clearing credentials.
 */
export async function disconnectCoros(
  userId: string,
  providerId?: string | null
): Promise<void> {
  const client = await getSystemClient();
  try {
    let query = `SELECT id, base_url, encrypted_app_id, app_id_iv, app_id_tag,
              encrypted_refresh_token, refresh_token_iv, refresh_token_tag
       FROM external_data_providers
       WHERE user_id = $1 AND provider_type = $2`;
    const params: (string | null)[] = [userId, COROS_PROVIDER_TYPE];
    if (providerId) {
      query += ' AND id = $3';
      params.push(providerId);
    }
    query += ' ORDER BY created_at DESC LIMIT 1';

    const res = await client.query(query, params);
    const row = res.rows[0] as
      | {
          id: string;
          base_url: string | null;
          encrypted_app_id: string | null;
          app_id_iv: string | null;
          app_id_tag: string | null;
          encrypted_refresh_token: string | null;
          refresh_token_iv: string | null;
          refresh_token_tag: string | null;
        }
      | undefined;

    if (!row) return;

    // Best-effort revoke
    if (
      row.encrypted_app_id &&
      row.app_id_iv &&
      row.app_id_tag &&
      row.encrypted_refresh_token &&
      row.refresh_token_iv &&
      row.refresh_token_tag
    ) {
      try {
        const mcpUrl = resolveCorosMcpUrl(row.base_url);
        const issuer = corosIssuerFromMcpUrl(mcpUrl);
        const clientId =
          (await decrypt(
            row.encrypted_app_id,
            row.app_id_iv,
            row.app_id_tag,
            ENCRYPTION_KEY
          )) || '';
        const refreshToken =
          (await decrypt(
            row.encrypted_refresh_token,
            row.refresh_token_iv,
            row.refresh_token_tag,
            ENCRYPTION_KEY
          )) || '';
        const revokeUrl = `${issuer}/oauth2/revoke`;
        await axios.post(
          revokeUrl,
          new URLSearchParams({
            token: refreshToken,
            client_id: clientId,
          }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 5000,
          }
        );
      } catch (err) {
        log('warn', `Failed to revoke COROS token on disconnect: ${err}`);
      }
    }

    await client.query(
      `UPDATE external_data_providers
       SET encrypted_access_token = NULL, access_token_iv = NULL, access_token_tag = NULL,
           encrypted_refresh_token = NULL, refresh_token_iv = NULL, refresh_token_tag = NULL,
           token_expires_at = NULL, external_user_id = NULL, oauth_state = NULL,
           is_active = FALSE, updated_at = NOW()
       WHERE id = $1`,
      [row.id]
    );
  } finally {
    client.release();
  }
}

export default {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  getValidAccessToken,
  withCorosMcp,
  getStatus,
  disconnectCoros,
  registerClient,
  getCorosRedirectUri,
};
