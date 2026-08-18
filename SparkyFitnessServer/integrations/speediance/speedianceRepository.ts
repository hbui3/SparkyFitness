import { getClient } from '../../db/poolManager.js';
import { decrypt, ENCRYPTION_KEY } from '../../security/encryption.js';
import type { SpeedianceRegion } from '@workspace/shared';
import { speedianceRegionFromBaseUrl } from './speedianceConfig.js';

interface EncryptedProviderRow {
  id: string;
  user_id: string;
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

export interface SpeedianceProviderCredentials {
  providerId: string;
  email: string;
  password: string;
  region: SpeedianceRegion;
  lastSyncAt: Date | null;
}

export interface SpeedianceProviderStatus {
  connected: boolean;
  active: boolean;
  region: SpeedianceRegion | null;
  lastSyncAt: Date | null;
}

async function findOwnedProviderRow(
  userId: string,
  providerId?: string
): Promise<EncryptedProviderRow | null> {
  const client = await getClient(userId, userId);
  try {
    const result = await client.query(
      `SELECT id, user_id, is_active, base_url, last_sync_at,
              encrypted_app_id, app_id_iv, app_id_tag,
              encrypted_app_key, app_key_iv, app_key_tag
       FROM external_data_providers
       WHERE user_id = $1
         AND provider_type = 'speediance'
         AND ($2::uuid IS NULL OR id = $2)
       ORDER BY is_active DESC, created_at DESC
       LIMIT 1`,
      [userId, providerId ?? null]
    );
    return (result.rows[0] as EncryptedProviderRow | undefined) ?? null;
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
  fieldLabel: string
): Promise<string> {
  if (!encryptedText || !iv || !tag) {
    throw new Error(`Speediance ${fieldLabel} is missing.`);
  }
  const decrypted = await decrypt(encryptedText, iv, tag, ENCRYPTION_KEY);
  if (!decrypted) {
    throw new Error(`Speediance ${fieldLabel} could not be decrypted.`);
  }
  return decrypted;
}

export async function getSpeedianceProviderCredentials(
  userId: string,
  providerId?: string
): Promise<SpeedianceProviderCredentials> {
  const row = await findOwnedProviderRow(userId, providerId);
  if (!row) throw new Error('Speediance provider was not found.');
  if (!row.is_active) throw new Error('Speediance provider is inactive.');

  const [email, password] = await Promise.all([
    decryptRequired(
      row.encrypted_app_id,
      row.app_id_iv,
      row.app_id_tag,
      'email'
    ),
    decryptRequired(
      row.encrypted_app_key,
      row.app_key_iv,
      row.app_key_tag,
      'password'
    ),
  ]);

  return {
    providerId: row.id,
    email,
    password,
    region: speedianceRegionFromBaseUrl(row.base_url),
    lastSyncAt: toDate(row.last_sync_at),
  };
}

export async function getSpeedianceProviderStatus(
  userId: string,
  providerId?: string
): Promise<SpeedianceProviderStatus> {
  const row = await findOwnedProviderRow(userId, providerId);
  if (!row) {
    return { connected: false, active: false, region: null, lastSyncAt: null };
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
    region: speedianceRegionFromBaseUrl(row.base_url),
    lastSyncAt: toDate(row.last_sync_at),
  };
}

export async function updateSpeedianceLastSync(
  userId: string,
  providerId: string,
  lastSyncAt: Date
): Promise<void> {
  const client = await getClient(userId, userId);
  try {
    await client.query(
      `UPDATE external_data_providers
       SET last_sync_at = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3 AND provider_type = 'speediance'`,
      [lastSyncAt, providerId, userId]
    );
  } finally {
    client.release();
  }
}
