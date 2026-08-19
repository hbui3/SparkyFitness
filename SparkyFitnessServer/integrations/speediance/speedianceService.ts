import {
  addDays,
  instantToDay,
  todayInZone,
  type SpeedianceStatusResponse,
  type SpeedianceSyncRequest,
  type SpeedianceSyncResponse,
} from '@workspace/shared';
import { log } from '../../config/logging.js';
import { loadUserTimezone } from '../../utils/timezoneLoader.js';
import {
  SpeedianceApiClient,
  SpeedianceAuthenticationError,
} from './speedianceApiClient.js';
import {
  getSpeedianceProviderCredentials,
  getSpeedianceProviderStatus,
  updateSpeedianceLastSync,
} from './speedianceRepository.js';
import {
  parseSpeedianceExerciseMetadata,
  parseSpeedianceTrainingDetail,
  parseSpeedianceTrainingRecords,
  type SpeedianceExerciseDetail,
  type SpeedianceExerciseMetadata,
} from './speedianceMapper.js';
import {
  processSpeedianceWorkouts,
  type SpeedianceWorkoutBundle,
} from './speedianceDataProcessor.js';

const INITIAL_SYNC_DAYS = 30;
const INCREMENTAL_OVERLAP_DAYS = 7;
const SPEEDIANCE_EARLIEST_DAY = '2018-01-01';
const DETAILED_TRAINING_TYPES = new Set([1, 2, 5, 7, 9]);
const EMPTY_DETAIL_RETRY_DELAY_MS = 250;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function resolveSyncRange(
  request: SpeedianceSyncRequest,
  timezone: string,
  lastSyncAt: Date | null
): { startDate: string; endDate: string } {
  if (request.startDate && request.endDate) {
    return { startDate: request.startDate, endDate: request.endDate };
  }

  const endDate = todayInZone(timezone);
  if (request.fullSync) {
    return { startDate: SPEEDIANCE_EARLIEST_DAY, endDate };
  }

  if (lastSyncAt) {
    const lastSyncDay = instantToDay(lastSyncAt, timezone);
    return {
      startDate: addDays(lastSyncDay, -INCREMENTAL_OVERLAP_DAYS),
      endDate,
    };
  }

  return { startDate: addDays(endDate, -INITIAL_SYNC_DAYS), endDate };
}

export async function syncSpeedianceData(
  userId: string,
  createdByUserId: string,
  request: SpeedianceSyncRequest
): Promise<SpeedianceSyncResponse> {
  const timezone = await loadUserTimezone(userId);
  const credentials = await getSpeedianceProviderCredentials(
    userId,
    request.providerId
  );
  const { startDate, endDate } = resolveSyncRange(
    request,
    timezone,
    credentials.lastSyncAt
  );
  const api = new SpeedianceApiClient({
    region: credentials.region,
    timezone,
  });

  log(
    'info',
    `[speedianceService] Syncing Speediance workouts for user ${userId} from ${startDate} through ${endDate}.`
  );
  await api.login(credentials.email, credentials.password);
  const rawRecords = await api.getTrainingRecords(startDate, endDate);
  const records = parseSpeedianceTrainingRecords(rawRecords);
  const bundles: SpeedianceWorkoutBundle[] = [];
  const metadataByActionGroup = new Map<
    string,
    Promise<SpeedianceExerciseMetadata | null>
  >();
  const metadataByAction = new Map<
    string,
    Promise<SpeedianceExerciseMetadata | null>
  >();

  const loadExerciseMetadata = (
    actionLibraryGroupId: string
  ): Promise<SpeedianceExerciseMetadata | null> => {
    const existing = metadataByActionGroup.get(actionLibraryGroupId);
    if (existing) return existing;

    const request = api
      .getActionLibraryGroup(actionLibraryGroupId)
      .then(parseSpeedianceExerciseMetadata)
      .catch((error: unknown) => {
        if (error instanceof SpeedianceAuthenticationError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        log(
          'warn',
          `[speedianceService] Muscle metadata for action group ${actionLibraryGroupId} was unavailable: ${message}`
        );
        return null;
      });
    metadataByActionGroup.set(actionLibraryGroupId, request);
    return request;
  };

  const loadActionMetadata = (
    actionLibraryId: string
  ): Promise<SpeedianceExerciseMetadata | null> => {
    const existing = metadataByAction.get(actionLibraryId);
    if (existing) return existing;

    const request = api
      .getActionLibrary(actionLibraryId)
      .then(parseSpeedianceExerciseMetadata)
      .catch((error: unknown) => {
        if (error instanceof SpeedianceAuthenticationError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        log(
          'warn',
          `[speedianceService] Muscle metadata for action ${actionLibraryId} was unavailable: ${message}`
        );
        return null;
      });
    metadataByAction.set(actionLibraryId, request);
    return request;
  };

  for (const record of records) {
    let exercises: SpeedianceExerciseDetail[] = [];
    let enrichedRecord = record;
    if (DETAILED_TRAINING_TYPES.has(record.type)) {
      let rawInfo: unknown = null;
      try {
        rawInfo = await api.getTrainingInfo(record.trainingId, record.type);
        if (isRecord(rawInfo)) {
          enrichedRecord = {
            ...record,
            raw: {
              ...record.raw,
              speedianceTrainingInfo: rawInfo,
            },
          };
        }
      } catch (error) {
        if (error instanceof SpeedianceAuthenticationError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        log(
          'warn',
          `[speedianceService] Info for training ${record.trainingId} was unavailable; retaining its report summary: ${message}`
        );
      }

      try {
        const loadRawDetail = (): Promise<unknown> =>
          record.type === 1
            ? api.getTrainingInfo(record.trainingId, record.type)
            : api.getTrainingDetail(record.trainingId, record.type);
        let rawDetail = record.type === 1 ? rawInfo : await loadRawDetail();
        exercises = parseSpeedianceTrainingDetail(rawDetail);
        if (exercises.length === 0) {
          await wait(EMPTY_DETAIL_RETRY_DELAY_MS);
          rawDetail = await loadRawDetail();
          exercises = parseSpeedianceTrainingDetail(rawDetail);
        }
      } catch (error) {
        if (error instanceof SpeedianceAuthenticationError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        log(
          'warn',
          `[speedianceService] Detail for training ${record.trainingId} was unavailable; importing its session summary instead: ${message}`
        );
      }
    }
    bundles.push({ record: enrichedRecord, exercises });
  }

  // Resolve exercise metadata only after every workout detail has been read.
  // This keeps the much larger metadata request set from rate-limiting later
  // history-detail calls and turning otherwise detailed sessions into summaries.
  for (const bundle of bundles) {
    bundle.exercises = await Promise.all(
      bundle.exercises.map(async (exercise) => {
        const metadata = exercise.actionLibraryGroupId
          ? await loadExerciseMetadata(exercise.actionLibraryGroupId)
          : exercise.actionLibraryId
            ? await loadActionMetadata(exercise.actionLibraryId)
            : null;
        if (!metadata) return exercise;
        return {
          ...exercise,
          ...metadata,
          actionLibraryGroupId:
            metadata.actionLibraryGroupId ?? exercise.actionLibraryGroupId,
        };
      })
    );
  }

  const result = await processSpeedianceWorkouts(
    userId,
    createdByUserId,
    bundles,
    startDate,
    endDate,
    timezone
  );
  await updateSpeedianceLastSync(userId, credentials.providerId, new Date());

  return {
    success: true,
    ...result,
    startDate,
    endDate,
  };
}

export async function getSpeedianceStatus(
  userId: string,
  providerId?: string
): Promise<SpeedianceStatusResponse> {
  const status = await getSpeedianceProviderStatus(userId, providerId);
  return {
    connected: status.connected,
    active: status.active,
    region: status.region,
    lastSyncAt: status.lastSyncAt?.toISOString() ?? null,
  };
}

export default { syncSpeedianceData, getSpeedianceStatus };
