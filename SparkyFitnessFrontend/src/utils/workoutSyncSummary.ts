import type {
  IGPSportSyncResponse,
  SpeedianceSyncResponse,
} from '@workspace/shared';

export type WorkoutSyncResponse = IGPSportSyncResponse | SpeedianceSyncResponse;

export function workoutSyncSummary(result: WorkoutSyncResponse) {
  return 'failedActivities' in result
    ? {
        imported: result.createdActivities,
        updated: result.updatedActivities,
        failed: result.failedActivities,
      }
    : {
        imported: result.importedWorkouts,
        updated: 0,
        failed: result.skippedWorkouts,
      };
}
