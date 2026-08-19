import {
  addDays,
  instantToDay,
  todayInZone,
  type IGPSportStatusResponse,
  type IGPSportSyncRequest,
  type IGPSportSyncResponse,
} from '@workspace/shared';
import { log } from '../../config/logging.js';
import fitImportService, {
  type FitImportSource,
} from '../../services/fitImportService.js';
import { loadUserTimezone } from '../../utils/timezoneLoader.js';
import { IGPSportApiClient } from './igpsportApiClient.js';
import {
  getIGPSportProviderCredentials,
  getIGPSportProviderStatus,
  updateIGPSportLastSync,
} from './igpsportRepository.js';

const INITIAL_SYNC_DAYS = 30;
const INCREMENTAL_OVERLAP_DAYS = 7;
const IGPSPORT_EARLIEST_DAY = '2010-01-01';
const MAX_ACTIVITY_PAGES = 10_000;

const IGPSPORT_FIT_SOURCE: FitImportSource = {
  entrySource: 'iGPSPORT',
  detailProviderName: 'iGPSPORT',
  exerciseSource: 'igpsport',
  notesPrefix: 'iGPSPORT FIT Import',
};

function resolveSyncRange(
  request: IGPSportSyncRequest,
  timezone: string,
  lastSyncAt: Date | null
): { startDate: string; endDate: string } {
  if (request.startDate && request.endDate) {
    return { startDate: request.startDate, endDate: request.endDate };
  }

  const endDate = todayInZone(timezone);
  if (request.fullSync) {
    return { startDate: IGPSPORT_EARLIEST_DAY, endDate };
  }
  if (lastSyncAt) {
    return {
      startDate: addDays(
        instantToDay(lastSyncAt, timezone),
        -INCREMENTAL_OVERLAP_DAYS
      ),
      endDate,
    };
  }
  return { startDate: addDays(endDate, -INITIAL_SYNC_DAYS), endDate };
}

export async function syncIGPSportData(
  userId: string,
  createdByUserId: string,
  request: IGPSportSyncRequest
): Promise<IGPSportSyncResponse> {
  const timezone = await loadUserTimezone(userId);
  const credentials = await getIGPSportProviderCredentials(
    userId,
    request.providerId
  );
  const { startDate, endDate } = resolveSyncRange(
    request,
    timezone,
    credentials.lastSyncAt
  );
  const api = new IGPSportApiClient({
    region: credentials.region,
    timezone,
  });

  log(
    'info',
    `[igpsportService] Syncing iGPSPORT activities for user ${userId} from ${startDate} through ${endDate}.`
  );
  await api.login(credentials.username, credentials.password);

  let createdActivities = 0;
  let updatedActivities = 0;
  let failedActivities = 0;
  let pageNumber = 1;

  while (true) {
    if (pageNumber > MAX_ACTIVITY_PAGES) {
      throw new Error(
        'iGPSPORT activity pagination exceeded the safety limit.'
      );
    }
    const page = await api.getActivitiesPage(startDate, endDate, pageNumber);
    for (const activity of page.activities) {
      try {
        const downloadUrl = await api.getActivityDownloadUrl(activity.rideId);
        const buffer = await api.downloadFitFile(downloadUrl);
        const imported = await fitImportService.importFitFiles(
          userId,
          createdByUserId,
          [
            {
              originalname: `igpsport-${activity.rideId}.fit`,
              buffer,
              sourceId: activity.rideId,
              activityName: activity.title,
            },
          ],
          IGPSPORT_FIT_SOURCE
        );
        createdActivities += imported.created;
        updatedActivities += imported.updated;
        failedActivities += imported.failed;
      } catch (error) {
        failedActivities += 1;
        const message = error instanceof Error ? error.message : String(error);
        log(
          'error',
          `[igpsportService] Activity ${activity.rideId} could not be imported: ${message}`
        );
      }
    }
    if (pageNumber >= page.totalPages) break;
    pageNumber += 1;
  }

  await updateIGPSportLastSync(userId, credentials.providerId, new Date());
  return {
    success: true,
    createdActivities,
    updatedActivities,
    failedActivities,
    startDate,
    endDate,
  };
}

export async function getIGPSportStatus(
  userId: string,
  providerId?: string
): Promise<IGPSportStatusResponse> {
  const status = await getIGPSportProviderStatus(userId, providerId);
  return {
    connected: status.connected,
    active: status.active,
    region: status.region,
    lastSyncAt: status.lastSyncAt?.toISOString() ?? null,
  };
}

export default { syncIGPSportData, getIGPSportStatus };
