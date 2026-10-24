import { instantToDay } from '@workspace/shared';
import type { ImportFitFileResult } from '@workspace/shared';
import { log } from '../../config/logging.js';
import { loadUserTimezone } from '../../utils/timezoneLoader.js';
import { importFitBuffer } from '../../services/fitImportService.js';
import { getOrCreateGarminExercise } from '../../services/garminService.js';
import exerciseEntryRepository from '../../models/exerciseEntry.js';
import { COROS_ENTRY_SOURCE, COROS_SPORT_TYPES } from './corosConstants.js';
import type { CorosFitResource, CorosSportRecord } from './corosMcpText.js';

export async function importCorosActivityFromFit(
  userId: string,
  record: CorosSportRecord,
  fit: CorosFitResource
): Promise<ImportFitFileResult> {
  return importFitBuffer(userId, userId, fit.data, fit.fileName, {
    source: COROS_ENTRY_SOURCE,
    sourceIdOverride: record.labelId,
    notesLabel: 'Logged from COROS',
  });
}

export async function importCorosActivitySummary(
  userId: string,
  record: CorosSportRecord
): Promise<{ id: string }> {
  const sportInfo = COROS_SPORT_TYPES[record.sportType];
  const exerciseName = sportInfo?.name ?? record.name ?? 'COROS Activity';
  const category = sportInfo?.category ?? 'cardio';

  const exercise = await getOrCreateGarminExercise(
    userId,
    exerciseName,
    category
  );

  let entryDate = record.date;
  if (record.startTimestamp) {
    try {
      const userTz = await loadUserTimezone(userId);
      entryDate = instantToDay(record.startTimestamp * 1000, userTz);
    } catch (e) {
      log(
        'warn',
        `Failed to convert startTimestamp to user timezone for record ${record.labelId}: ${e}`
      );
    }
  }

  const durationMinutes = record.durationSeconds
    ? Math.round((record.durationSeconds / 60) * 100) / 100
    : 0;
  const distanceKm = record.distanceMeters
    ? Math.round((record.distanceMeters / 1000) * 1000) / 1000
    : null;
  const caloriesBurned = record.calories ? Math.round(record.calories) : 0;
  const avgHeartRate = record.avgHeartRate
    ? Math.round(record.avgHeartRate)
    : null;
  const notes = `Logged from COROS (summary only): ${record.name}.`;

  const entry = await exerciseEntryRepository.createExerciseEntry(
    userId,
    {
      exercise_id: exercise.id,
      source_id: record.labelId,
      duration_minutes: durationMinutes,
      calories_burned: caloriesBurned,
      distance: distanceKm,
      avg_heart_rate: avgHeartRate,
      entry_date: entryDate,
      notes,
    },
    userId,
    COROS_ENTRY_SOURCE
  );

  return { id: entry.id };
}

export default {
  importCorosActivityFromFit,
  importCorosActivitySummary,
};
