import { getClient } from '../db/poolManager.js';
import { decrypt, ENCRYPTION_KEY } from '../security/encryption.js';

interface EncryptedCredentialProviderRow {
  id: string;
  is_active: boolean;
  base_url: string | null;
  last_sync_at: Date | string | null;
  encrypted_app_id: string | null;
  app_id_iv: string | null;
  app_id_tag: string | null;
  encrypted_app_key: string | null;
  app_key_iv: string | null;
  app_key_tag: string | null;
}

export interface CredentialProviderValues {
  providerId: string;
  username: string;
  password: string;
  baseUrl: string | null;
  lastSyncAt: Date | null;
}

export interface CredentialProviderStatus {
  connected: boolean;
  active: boolean;
  baseUrl: string | null;
  lastSyncAt: Date | null;
}

interface CredentialProviderRequest {
  userId: string;
  providerType: string;
  providerDisplayName: string;
  providerId?: string;
  usernameLabel?: string;
}

async function findOwnedProviderRow(
  userId: string,
  providerType: string,
  providerId?: string
): Promise<EncryptedCredentialProviderRow | null> {
  const client = await getClient(userId, userId);
  try {
    const result = await client.query(
      `SELECT id, is_active, base_url, last_sync_at,
              encrypted_app_id, app_id_iv, app_id_tag,
              encrypted_app_key, app_key_iv, app_key_tag
       FROM external_data_providers
       WHERE user_id = $1
         AND provider_type = $2
         AND ($3::uuid IS NULL OR id = $3)
       ORDER BY is_active DESC, created_at DESC
       LIMIT 1`,
      [userId, providerType, providerId ?? null]
    );
    return (
      (result.rows[0] as EncryptedCredentialProviderRow | undefined) ?? null
    );
  } finally {
    client.release();
  }
}

function toDate(value: Date | string | null): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function decryptRequired(
  encryptedText: string | null,
  iv: string | null,
  tag: string | null,
  providerDisplayName: string,
  fieldLabel: string
): Promise<string> {
  if (!encryptedText || !iv || !tag) {
    throw new Error(`${providerDisplayName} ${fieldLabel} is missing.`);
  }
  const decrypted = await decrypt(encryptedText, iv, tag, ENCRYPTION_KEY);
  if (!decrypted) {
    throw new Error(
      `${providerDisplayName} ${fieldLabel} could not be decrypted.`
    );
  }
  return decrypted;
}

export async function getCredentialProviderValues({
  userId,
  providerType,
  providerDisplayName,
  providerId,
  usernameLabel = 'username',
}: CredentialProviderRequest): Promise<CredentialProviderValues> {
  const row = await findOwnedProviderRow(userId, providerType, providerId);
  if (!row) throw new Error(`${providerDisplayName} provider was not found.`);
  if (!row.is_active)
    throw new Error(`${providerDisplayName} provider is inactive.`);

  const [username, password] = await Promise.all([
    decryptRequired(
      row.encrypted_app_id,
      row.app_id_iv,
      row.app_id_tag,
      providerDisplayName,
      usernameLabel
    ),
    decryptRequired(
      row.encrypted_app_key,
      row.app_key_iv,
      row.app_key_tag,
      providerDisplayName,
      'password'
    ),
  ]);

  return {
    providerId: row.id,
    username,
    password,
    baseUrl: row.base_url,
    lastSyncAt: toDate(row.last_sync_at),
  };
}

export async function getCredentialProviderStatus(
  userId: string,
  providerType: string,
  providerId?: string
): Promise<CredentialProviderStatus> {
  const row = await findOwnedProviderRow(userId, providerType, providerId);
  if (!row) {
    return {
      connected: false,
      active: false,
      baseUrl: null,
      lastSyncAt: null,
    };
  }

  return {
    connected: Boolean(
      row.encrypted_app_id &&
      row.app_id_iv &&
      row.app_id_tag &&
      row.encrypted_app_key &&
      row.app_key_iv &&
      row.app_key_tag
    ),
    active: row.is_active,
    baseUrl: row.base_url,
    lastSyncAt: toDate(row.last_sync_at),
  };
}

export async function updateCredentialProviderLastSync(
  userId: string,
  providerType: string,
  providerId: string,
  lastSyncAt: Date
): Promise<void> {
  const client = await getClient(userId, userId);
  try {
    await client.query(
      `UPDATE external_data_providers
       SET last_sync_at = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3 AND provider_type = $4`,
      [lastSyncAt, providerId, userId, providerType]
    );
  } finally {
    client.release();
  }
}
