import axios, { type AxiosInstance } from 'axios';
import type { IGPSportRegion } from '@workspace/shared';
import {
  createGuardedFetch,
  PUBLIC_ONLY_OUTBOUND_NETWORK_POLICY,
} from '../../utils/outboundUrlPolicy.js';
import { igpsportBaseUrlForRegion } from './igpsportConfig.js';

const PAGE_SIZE = 20;
const MAX_FIT_BYTES = 50 * 1024 * 1024;
const MAX_DOWNLOAD_REDIRECTS = 3;

interface IGPSportEnvelope {
  code?: unknown;
  message?: unknown;
  data?: unknown;
}

interface IGPSportSession {
  accessToken: string;
}

export interface IGPSportActivity {
  rideId: string;
  title: string;
  startTime: string;
  productName: string | null;
}

export interface IGPSportActivityPage {
  activities: IGPSportActivity[];
  page: number;
  totalPages: number;
  totalRows: number;
}

interface IGPSportApiClientOptions {
  region: IGPSportRegion;
  timezone: string;
  httpClient?: AxiosInstance;
  downloadFetch?: typeof fetch;
}

export class IGPSportAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IGPSportAuthenticationError';
  }
}

export class IGPSportApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IGPSportApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asEnvelope(value: unknown): IGPSportEnvelope {
  return isRecord(value) ? value : {};
}

function finiteInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function isAuthenticationResponseError(error: unknown): boolean {
  return (
    axios.isAxiosError(error) &&
    (error.response?.status === 401 || error.response?.status === 403)
  );
}

function parseActivity(value: unknown): IGPSportActivity | null {
  if (!isRecord(value)) return null;
  const rideId = value.rideId;
  if (
    (typeof rideId !== 'string' && typeof rideId !== 'number') ||
    String(rideId).length === 0
  ) {
    return null;
  }
  return {
    rideId: String(rideId),
    title: stringValue(value.title, 'Cycling'),
    startTime: stringValue(value.startTime),
    productName:
      typeof value.productName === 'string' ? value.productName : null,
  };
}

export class IGPSportApiClient {
  private readonly baseUrl: string;
  private readonly timezone: string;
  private readonly http: AxiosInstance;
  private readonly downloadFetch: typeof fetch;
  private session: IGPSportSession | null = null;

  constructor(options: IGPSportApiClientOptions) {
    this.baseUrl = igpsportBaseUrlForRegion(options.region);
    this.timezone = options.timezone;
    this.http =
      options.httpClient ??
      axios.create({
        baseURL: this.baseUrl,
        timeout: 30_000,
      });
    this.downloadFetch =
      options.downloadFetch ??
      createGuardedFetch(PUBLIC_ONLY_OUTBOUND_NETWORK_POLICY);
  }

  private commonHeaders(): Record<string, string> {
    return {
      Accept: 'application/json, text/plain, */*',
      timezone: this.timezone,
      'qiwu-app-version': '1.0.0',
    };
  }

  private authenticatedHeaders(): Record<string, string> {
    if (!this.session) {
      throw new IGPSportAuthenticationError('iGPSPORT is not authenticated.');
    }
    return {
      ...this.commonHeaders(),
      Authorization: `Bearer ${this.session.accessToken}`,
    };
  }

  private unwrap(responseBody: unknown, resource: string): unknown {
    const envelope = asEnvelope(responseBody);
    const code =
      envelope.code === undefined ? undefined : Number(envelope.code);
    if (
      code !== undefined &&
      (!Number.isFinite(code) || (code !== 0 && code !== 200))
    ) {
      const message =
        typeof envelope.message === 'string' && envelope.message
          ? envelope.message
          : `Unable to load iGPSPORT ${resource}.`;
      if (code === 401 || code === 403) {
        throw new IGPSportAuthenticationError(message);
      }
      throw new IGPSportApiError(message);
    }
    return envelope.data;
  }

  async login(username: string, password: string): Promise<void> {
    try {
      const response = await this.http.post(
        '/service/auth/account/login',
        { appId: 'igpsport-web', username, password },
        { headers: this.commonHeaders() }
      );
      const data = this.unwrap(response.data, 'login');
      if (!isRecord(data) || typeof data.access_token !== 'string') {
        throw new IGPSportAuthenticationError(
          'iGPSPORT login failed. Check the account, password, and region.'
        );
      }
      this.session = { accessToken: data.access_token };
    } catch (error) {
      if (
        error instanceof IGPSportAuthenticationError ||
        error instanceof IGPSportApiError
      ) {
        throw error;
      }
      if (isAuthenticationResponseError(error)) {
        throw new IGPSportAuthenticationError(
          'iGPSPORT rejected the account, password, or selected region.'
        );
      }
      throw new IGPSportApiError('Unable to connect to the iGPSPORT API.');
    }
  }

  async getActivitiesPage(
    startDate: string,
    endDate: string,
    page = 1
  ): Promise<IGPSportActivityPage> {
    try {
      const response = await this.http.get(
        '/service/web-gateway/web-analyze/activity/queryMyActivity',
        {
          headers: this.authenticatedHeaders(),
          params: {
            pageNo: page,
            pageSize: PAGE_SIZE,
            beginTime: startDate,
            endTime: endDate,
            reqType: '0',
            sort: '1',
          },
        }
      );
      const data = this.unwrap(response.data, 'activity history');
      if (!isRecord(data)) {
        return { activities: [], page, totalPages: page, totalRows: 0 };
      }
      const rows = Array.isArray(data.rows) ? data.rows : [];
      return {
        activities: rows
          .map(parseActivity)
          .filter((item): item is IGPSportActivity => item !== null),
        page: finiteInteger(data.pageNo, page),
        totalPages: Math.max(1, finiteInteger(data.totalPage, 1)),
        totalRows: finiteInteger(data.totalRows, rows.length),
      };
    } catch (error) {
      this.rethrowReadError(error, 'activity history');
    }
  }

  async getActivityDownloadUrl(rideId: string): Promise<string> {
    try {
      const response = await this.http.get(
        `/service/web-gateway/web-analyze/activity/getDownloadUrl/${encodeURIComponent(rideId)}`,
        { headers: this.authenticatedHeaders() }
      );
      const data = this.unwrap(response.data, 'FIT download URL');
      if (typeof data !== 'string' || !data) {
        throw new IGPSportApiError(
          `iGPSPORT activity ${rideId} has no FIT download URL.`
        );
      }
      return data;
    } catch (error) {
      this.rethrowReadError(error, 'FIT download URL');
    }
  }

  async downloadFitFile(downloadUrl: string): Promise<Buffer> {
    let currentUrl = this.parseDownloadUrl(downloadUrl);
    for (let redirect = 0; redirect <= MAX_DOWNLOAD_REDIRECTS; redirect += 1) {
      const headers =
        currentUrl.origin === this.baseUrl
          ? this.authenticatedHeaders()
          : undefined;
      const response = await this.downloadFetch(currentUrl, { headers });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirect === MAX_DOWNLOAD_REDIRECTS) {
          throw new IGPSportApiError(
            'iGPSPORT FIT download redirected too many times.'
          );
        }
        currentUrl = this.parseDownloadUrl(
          new URL(location, currentUrl).toString()
        );
        continue;
      }
      if (!response.ok) {
        throw new IGPSportApiError(
          `iGPSPORT FIT download failed with HTTP ${response.status}.`
        );
      }
      const advertisedBytes = Number(response.headers.get('content-length'));
      if (Number.isFinite(advertisedBytes) && advertisedBytes > MAX_FIT_BYTES) {
        throw new IGPSportApiError('iGPSPORT FIT file exceeds the 50MB limit.');
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_FIT_BYTES) {
        throw new IGPSportApiError('iGPSPORT FIT file exceeds the 50MB limit.');
      }
      return bytes;
    }
    throw new IGPSportApiError('iGPSPORT FIT download failed.');
  }

  private parseDownloadUrl(value: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new IGPSportApiError(
        'iGPSPORT returned an invalid FIT download URL.'
      );
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new IGPSportApiError(
        'iGPSPORT returned an unsafe FIT download URL.'
      );
    }
    return parsed;
  }

  private rethrowReadError(error: unknown, resource: string): never {
    if (
      error instanceof IGPSportAuthenticationError ||
      error instanceof IGPSportApiError
    ) {
      throw error;
    }
    if (isAuthenticationResponseError(error)) {
      throw new IGPSportAuthenticationError(
        'iGPSPORT rejected the current session.'
      );
    }
    throw new IGPSportApiError(`Unable to load iGPSPORT ${resource}.`);
  }
}
