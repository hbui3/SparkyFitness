import type { IGPSportRegion } from '@workspace/shared';
import {
  getCredentialProviderStatus,
  getCredentialProviderValues,
  updateCredentialProviderLastSync,
} from '../credentialProviderRepository.js';
import { igpsportRegionFromBaseUrl } from './igpsportConfig.js';

export interface IGPSportProviderCredentials {
  providerId: string;
  username: string;
  password: string;
  region: IGPSportRegion;
  lastSyncAt: Date | null;
}

export interface IGPSportProviderStatus {
  connected: boolean;
  active: boolean;
  region: IGPSportRegion | null;
  lastSyncAt: Date | null;
}

export async function getIGPSportProviderCredentials(
  userId: string,
  providerId?: string
): Promise<IGPSportProviderCredentials> {
  const values = await getCredentialProviderValues({
    userId,
    providerType: 'igpsport',
    providerDisplayName: 'iGPSPORT',
    providerId,
    usernameLabel: 'account',
  });
  return {
    providerId: values.providerId,
    username: values.username,
    password: values.password,
    region: igpsportRegionFromBaseUrl(values.baseUrl),
    lastSyncAt: values.lastSyncAt,
  };
}

export async function getIGPSportProviderStatus(
  userId: string,
  providerId?: string
): Promise<IGPSportProviderStatus> {
  const status = await getCredentialProviderStatus(
    userId,
    'igpsport',
    providerId
  );
  if (!status.connected && !status.active && status.baseUrl === null) {
    return { connected: false, active: false, region: null, lastSyncAt: null };
  }
  return {
    connected: status.connected,
    active: status.active,
    region: igpsportRegionFromBaseUrl(status.baseUrl),
    lastSyncAt: status.lastSyncAt,
  };
}

export async function updateIGPSportLastSync(
  userId: string,
  providerId: string,
  lastSyncAt: Date
): Promise<void> {
  await updateCredentialProviderLastSync(
    userId,
    'igpsport',
    providerId,
    lastSyncAt
  );
}
