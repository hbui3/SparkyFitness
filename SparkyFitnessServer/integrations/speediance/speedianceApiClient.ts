import axios, { type AxiosInstance } from 'axios';
import type { SpeedianceRegion } from '@workspace/shared';
import { speedianceBaseUrlForRegion } from './speedianceConfig.js';

const SPEEDIANCE_VERSION_CODE = '40304';
const SPEEDIANCE_DEVICE =
  '{"brand":"google","device":"emulator64_x86_64_arm64","deviceType":"sdk_gphone64_x86_64","os":"","os_version":"31","manufacturer":"Google"}';

interface SpeedianceEnvelope {
  code?: number;
  data?: unknown;
}

interface SpeedianceSession {
  token: string;
  appUserId: string;
}

interface SpeedianceApiClientOptions {
  region: SpeedianceRegion;
  timezone: string;
  httpClient?: AxiosInstance;
}

interface SpeedianceTrainingRoute {
  info: string;
  detail: string;
}

export interface SpeedianceCustomWorkoutActionPayload {
  groupId: number;
  actionLibraryId: number;
  templatePresetId: number;
  setsAndReps: string;
  breakTime: string;
  breakTime2: string;
  sportMode: string;
  leftRight: string;
  selectCompletionMethod: string;
  completionMethod: string;
  countType: string;
  weights: string;
  counterweight2: string;
  counterweight: string;
  level: string;
  capacity: number;
}

export interface SpeedianceCustomWorkoutPayload {
  name: string;
  actionLibraryList: SpeedianceCustomWorkoutActionPayload[];
  totalCapacity: number;
  deviceType: number;
  bgColor: number;
}

const TRAINING_ROUTES: Record<number, SpeedianceTrainingRoute> = {
  1: {
    info: 'freeTraining',
    detail: 'freeTraining',
  },
  2: {
    info: 'courseTrainingInfo',
    detail: 'courseTrainingInfoDetail',
  },
  5: {
    info: 'cttTrainingInfo',
    detail: 'cttTrainingInfoDetail',
  },
  7: {
    info: 'freeTraining',
    detail: 'freeTrainingDetail',
  },
  9: {
    info: 'aiCourseTrainingInfo',
    detail: 'aiCourseTrainingInfoDetail',
  },
};

export class SpeedianceAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeedianceAuthenticationError';
  }
}

export class SpeedianceApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeedianceApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asEnvelope(value: unknown): SpeedianceEnvelope {
  return isRecord(value) ? value : {};
}

function utcOffsetHeader(timezone: string, instant = new Date()): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(instant)
      .find((part) => part.type === 'timeZoneName')?.value;
    if (!name || name === 'GMT' || name === 'UTC') return '+0000';
    const match = name.match(/^GMT([+-])(\d{2}):(\d{2})$/);
    return match ? `${match[1]}${match[2]}${match[3]}` : '+0000';
  } catch {
    return '+0000';
  }
}

export class SpeedianceApiClient {
  private readonly baseUrl: string;
  private readonly host: string;
  private readonly timezone: string;
  private readonly http: AxiosInstance;
  private session: SpeedianceSession | null = null;

  constructor(options: SpeedianceApiClientOptions) {
    this.baseUrl = speedianceBaseUrlForRegion(options.region);
    this.host = new URL(this.baseUrl).host;
    this.timezone = options.timezone;
    this.http =
      options.httpClient ??
      axios.create({
        baseURL: this.baseUrl,
        timeout: 20_000,
      });
  }

  private commonHeaders(): Record<string, string> {
    return {
      Host: this.host,
      'User-Agent': 'Dart/3.9 (dart:io)',
      'Content-Type': 'application/json',
      Timestamp: String(Date.now()),
      Timezone: this.timezone,
      Utc_offset: utcOffsetHeader(this.timezone),
      Versioncode: SPEEDIANCE_VERSION_CODE,
      Mobiledevices: SPEEDIANCE_DEVICE,
      'Accept-Language': 'en',
      App_type: 'SOFTWARE',
    };
  }

  private authenticatedHeaders(): Record<string, string> {
    if (!this.session) {
      throw new SpeedianceAuthenticationError(
        'Speediance is not authenticated.'
      );
    }
    return {
      ...this.commonHeaders(),
      App_user_id: this.session.appUserId,
      Token: this.session.token,
    };
  }

  private unwrap(responseBody: unknown): unknown {
    const envelope = asEnvelope(responseBody);
    if (envelope.code === 91) {
      throw new SpeedianceAuthenticationError(
        'Speediance rejected the current session.'
      );
    }
    return envelope.data;
  }

  private unwrapWrite(responseBody: unknown, operation: string): unknown {
    const envelope = asEnvelope(responseBody);
    const data = this.unwrap(responseBody);
    if (typeof envelope.code === 'number' && envelope.code !== 0) {
      throw new SpeedianceApiError(`Speediance rejected ${operation}.`);
    }
    return data;
  }

  async login(email: string, password: string): Promise<void> {
    try {
      const verifyResponse = await this.http.post(
        '/api/app/v2/login/verifyIdentity',
        { type: 2, userIdentity: email },
        { headers: this.commonHeaders() }
      );
      const verifyData = this.unwrap(verifyResponse.data);
      if (!isRecord(verifyData) || verifyData.isExist === false) {
        throw new SpeedianceAuthenticationError(
          'Speediance account was not found in the selected region.'
        );
      }
      if (verifyData.hasPwd === false) {
        throw new SpeedianceAuthenticationError(
          'The Speediance account has no password configured.'
        );
      }

      const loginResponse = await this.http.post(
        '/api/app/v2/login/byPass',
        { userIdentity: email, password, type: 2 },
        { headers: this.commonHeaders() }
      );
      const loginData = this.unwrap(loginResponse.data);
      if (!isRecord(loginData)) {
        throw new SpeedianceAuthenticationError('Speediance login failed.');
      }
      const token = loginData.token;
      const appUserId = loginData.appUserId;
      if (
        typeof token !== 'string' ||
        !token ||
        appUserId === null ||
        appUserId === undefined
      ) {
        throw new SpeedianceAuthenticationError('Speediance login failed.');
      }

      this.session = { token, appUserId: String(appUserId) };
    } catch (error) {
      if (error instanceof SpeedianceAuthenticationError) throw error;
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        throw new SpeedianceAuthenticationError(
          'Speediance rejected the email, password, or selected region.'
        );
      }
      throw new SpeedianceApiError('Unable to connect to the Speediance API.');
    }
  }

  async getTrainingRecords(
    startDate: string,
    endDate: string
  ): Promise<unknown[]> {
    try {
      const response = await this.http.get(
        '/api/mobile/v2/report/userTrainingDataRecord',
        {
          headers: this.authenticatedHeaders(),
          params: { startDate, endDate },
        }
      );
      const data = this.unwrap(response.data);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      this.rethrowReadError(error, 'training history');
    }
  }

  async getTrainingDetail(
    trainingId: string,
    trainingType: number
  ): Promise<unknown> {
    return this.getTrainingResource(trainingId, trainingType, 'detail');
  }

  async getTrainingInfo(
    trainingId: string,
    trainingType: number
  ): Promise<unknown> {
    return this.getTrainingResource(trainingId, trainingType, 'info');
  }

  async getActionLibraryGroup(actionLibraryGroupId: string): Promise<unknown> {
    try {
      const response = await this.http.get(
        `/api/app/actionLibraryGroup/${encodeURIComponent(actionLibraryGroupId)}`,
        {
          headers: this.authenticatedHeaders(),
          // Legacy groups return no muscle data with isDisplay=1, while both
          // legacy and current groups expose it with isDisplay=0.
          params: { isDisplay: 0 },
        }
      );
      return this.unwrap(response.data);
    } catch (error) {
      this.rethrowReadError(error, 'exercise metadata');
    }
  }

  async getActionLibrary(actionLibraryId: string): Promise<unknown> {
    try {
      const response = await this.http.get(
        `/api/app/actionLibrary/${encodeURIComponent(actionLibraryId)}`,
        { headers: this.authenticatedHeaders() }
      );
      return this.unwrap(response.data);
    } catch (error) {
      this.rethrowReadError(error, 'exercise action metadata');
    }
  }

  async getActionLibraryTabs(deviceType = 1): Promise<unknown[]> {
    try {
      const response = await this.http.get('/api/app/actionLibraryTab/list', {
        headers: this.authenticatedHeaders(),
        params: { deviceType },
      });
      const data = this.unwrap(response.data);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      this.rethrowReadError(error, 'exercise categories');
    }
  }

  async getActionLibraryGroups(
    tabId: string,
    deviceType = 1
  ): Promise<unknown[]> {
    try {
      const response = await this.http.get(
        '/api/app/actionLibraryGroup/trainingPartGroup',
        {
          headers: this.authenticatedHeaders(),
          params: { tabId, deviceTypeList: deviceType },
        }
      );
      const data = this.unwrap(response.data);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      this.rethrowReadError(error, 'exercise library');
    }
  }

  async getAccessories(): Promise<unknown[]> {
    try {
      const response = await this.http.get('/api/app/accessories/list', {
        headers: this.authenticatedHeaders(),
      });
      const data = this.unwrap(response.data);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      this.rethrowReadError(error, 'accessories');
    }
  }

  async getCustomWorkouts(deviceType = 1): Promise<unknown[]> {
    try {
      const response = await this.http.get(
        '/api/app/v4/customTrainingTemplate/appPage',
        {
          headers: this.authenticatedHeaders(),
          params: { pageNo: 1, pageSize: -1, deviceTypes: deviceType },
        }
      );
      const data = this.unwrap(response.data);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      this.rethrowReadError(error, 'custom workouts');
    }
  }

  async getCustomWorkoutDetail(code: string): Promise<unknown> {
    try {
      const response = await this.http.get(
        '/api/app/v3/customTrainingTemplate/detailByCode',
        {
          headers: this.authenticatedHeaders(),
          params: { code },
        }
      );
      return this.unwrap(response.data);
    } catch (error) {
      this.rethrowReadError(error, 'custom workout detail');
    }
  }

  async createCustomWorkout(
    payload: SpeedianceCustomWorkoutPayload
  ): Promise<unknown> {
    try {
      const response = await this.http.post(
        '/api/app/v2/customTrainingTemplate',
        payload,
        { headers: this.authenticatedHeaders() }
      );
      return this.unwrapWrite(response.data, 'custom workout creation');
    } catch (error) {
      this.rethrowWriteError(error, 'custom workout creation');
    }
  }

  async updateCustomWorkout(
    templateId: number,
    payload: SpeedianceCustomWorkoutPayload
  ): Promise<unknown> {
    try {
      const response = await this.http.post(
        '/api/app/v2/customTrainingTemplate',
        { ...payload, id: templateId },
        { headers: this.authenticatedHeaders() }
      );
      return this.unwrapWrite(response.data, 'custom workout update');
    } catch (error) {
      this.rethrowWriteError(error, 'custom workout update');
    }
  }

  async deleteCustomWorkout(templateId: number): Promise<unknown> {
    try {
      const response = await this.http.delete(
        '/api/app/customTrainingTemplate',
        {
          headers: this.authenticatedHeaders(),
          params: { ids: templateId },
        }
      );
      return this.unwrapWrite(response.data, 'custom workout deletion');
    } catch (error) {
      this.rethrowWriteError(error, 'custom workout deletion');
    }
  }

  async getTrainingCalendarMonth(
    month: string,
    deviceType = 1
  ): Promise<unknown[]> {
    try {
      const response = await this.http.get(
        '/api/app/v5/trainingCalendar/monthNew',
        {
          headers: this.authenticatedHeaders(),
          params: { date: month, selectedDeviceType: deviceType },
        }
      );
      const data = this.unwrap(response.data);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      this.rethrowReadError(error, 'training calendar');
    }
  }

  async setTemplateReservation(
    day: string,
    templateCode: string,
    status: 0 | 1,
    deviceType = 1
  ): Promise<unknown> {
    try {
      const response = await this.http.post(
        '/api/app/templateReservation',
        { status, deviceType, thatDay: day, templateCode },
        { headers: this.authenticatedHeaders() }
      );
      return this.unwrapWrite(response.data, 'workout scheduling');
    } catch (error) {
      this.rethrowWriteError(error, 'workout scheduling');
    }
  }

  private async getTrainingResource(
    trainingId: string,
    trainingType: number,
    resource: keyof SpeedianceTrainingRoute
  ): Promise<unknown> {
    const route = TRAINING_ROUTES[trainingType];
    if (!route) {
      throw new SpeedianceApiError(
        `Unsupported Speediance training type ${trainingType}.`
      );
    }
    const path = `/api/app/trainingInfo/${route[resource]}/${encodeURIComponent(trainingId)}`;
    try {
      const response = await this.http.get(path, {
        headers: this.authenticatedHeaders(),
      });
      return this.unwrap(response.data);
    } catch (error) {
      this.rethrowReadError(error, `training ${resource}`);
    }
  }

  private rethrowReadError(error: unknown, resource: string): never {
    if (error instanceof SpeedianceAuthenticationError) throw error;
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      throw new SpeedianceAuthenticationError(
        'Speediance rejected the current session.'
      );
    }
    throw new SpeedianceApiError(`Unable to load Speediance ${resource}.`);
  }

  private rethrowWriteError(error: unknown, operation: string): never {
    if (
      error instanceof SpeedianceAuthenticationError ||
      error instanceof SpeedianceApiError
    ) {
      throw error;
    }
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      throw new SpeedianceAuthenticationError(
        'Speediance rejected the current session.'
      );
    }
    throw new SpeedianceApiError(`Unable to perform ${operation}.`);
  }
}
