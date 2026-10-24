import { addDays, todayInZone } from '@workspace/shared';
import type {
  SymptomContextDay,
  SymptomEpisodeContext,
} from '@workspace/shared';
import measurementRepository from '../models/measurementRepository.js';
import symptomContextRepository from '../models/symptomContextRepository.js';
import cycleService from './cycleService.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';
import { log } from '../config/logging.js';

/** A day's worth of names shown per entry; keeps the report readable. */
const MAX_NAMES_PER_DAY = 30;

const unique = (values: string[]): string[] => [...new Set(values)];

function groupNames<T extends { entry_date: string }>(
  rows: T[],
  pick: (row: T) => string
): Map<string, string[]> {
  const byDay = new Map<string, string[]>();
  for (const row of rows) {
    const list = byDay.get(row.entry_date) ?? [];
    list.push(pick(row));
    byDay.set(row.entry_date, list);
  }
  return byDay;
}

const doseLabel = (
  amount: number | null,
  unit: string | null
): string | null =>
  amount !== null && amount !== undefined && unit ? `${amount} ${unit}` : null;

/**
 * The diary around each requested symptom entry: what was eaten, drunk, walked
 * and slept the day before and the day of, the night's sleep before it began,
 * doses taken while it ran, and the cycle day for the owner.
 *
 * Everything is read through the caller's row-level security, so a delegate
 * only ever sees the parts they are allowed to. Cycle data is reproductive-health
 * data and is only looked up for the account owner.
 */
async function getEpisodeContext(
  userId: string,
  ids: string[],
  options: { isOwner: boolean }
): Promise<SymptomEpisodeContext[]> {
  const anchors = await symptomContextRepository.getEntryAnchors(userId, ids);
  if (anchors.length === 0) return [];

  const dayOf = (a: { entry_date: string }) => a.entry_date;
  const dayBefore = (a: { entry_date: string }) => addDays(a.entry_date, -1);
  const dates = unique(anchors.flatMap((a) => [dayBefore(a), dayOf(a)])).sort();
  const first = dates[0] as string;
  const last = dates[dates.length - 1] as string;
  const now = new Date();

  const [foods, water, steps, workouts, sleep, doses] = await Promise.all([
    symptomContextRepository.getFoodNames(userId, first, last),
    measurementRepository.getWaterIntakesByDates(userId, dates),
    symptomContextRepository.getSteps(userId, dates),
    symptomContextRepository.getWorkoutNames(userId, dates),
    symptomContextRepository.getPreviousSleep(
      userId,
      anchors.map((a) => ({ id: a.id, at: a.at }))
    ),
    symptomContextRepository.getDoses(
      userId,
      anchors
        .filter((a) => a.started_at !== null)
        .map((a) => ({
          id: a.id,
          from: a.at,
          to: a.ended_at ?? now,
        }))
    ),
  ]);

  const foodsByDay = groupNames(foods, (r) => r.food_name);
  const workoutsByDay = groupNames(workouts, (r) => r.exercise_name);
  const waterByDay = new Map<string, number>(
    (water as Array<{ entry_date: string; water_ml: number | string }>).map(
      (r) => [r.entry_date, Number(r.water_ml)]
    )
  );
  const stepsByDay = new Map(steps.map((r) => [r.entry_date, Number(r.steps)]));
  const sleepByEntry = new Map(sleep.map((r) => [r.entry_id, r]));

  // Cycle phase is looked up once per distinct day, and only for the owner.
  const cycleByDay = new Map<
    string,
    { phase: string; cycle_day: number | null } | null
  >();
  if (options.isOwner) {
    const today = todayInZone(await loadUserTimezone(userId));
    for (const date of unique(anchors.map(dayOf))) {
      try {
        const overview = await cycleService.getOverview(userId, today, date);
        cycleByDay.set(
          date,
          overview.settings?.enabled && overview.phase !== 'unknown'
            ? { phase: overview.phase, cycle_day: overview.cycleDay }
            : null
        );
      } catch (error) {
        // Context is a convenience; one failed lookup must not sink the report.
        log('warn', `Cycle context unavailable for ${date}:`, error);
        cycleByDay.set(date, null);
      }
    }
  }

  const buildDay = (
    date: string,
    label: SymptomContextDay['label']
  ): SymptomContextDay => ({
    date,
    label,
    foods: (foodsByDay.get(date) ?? []).slice(0, MAX_NAMES_PER_DAY),
    water_ml: waterByDay.has(date) ? (waterByDay.get(date) as number) : null,
    steps: stepsByDay.has(date) ? (stepsByDay.get(date) as number) : null,
    workouts: unique(workoutsByDay.get(date) ?? []).slice(0, MAX_NAMES_PER_DAY),
  });

  return anchors.map((a) => {
    const slept = sleepByEntry.get(a.id);
    return {
      entry_id: a.id,
      sleep: slept
        ? {
            minutes: Math.round(Number(slept.asleep_seconds) / 60),
            bedtime: slept.bedtime.toISOString(),
            wake_time: slept.wake_time.toISOString(),
          }
        : null,
      days: [
        buildDay(dayBefore(a), 'day_before'),
        buildDay(dayOf(a), 'day_of'),
      ],
      medications: doses
        .filter((d) => d.entry_id === a.id)
        .map((d) => ({
          name: d.med_name_snapshot ?? '',
          dose: doseLabel(d.dose_amount_snapshot, d.dose_unit_snapshot),
          taken_at: d.taken_at.toISOString(),
        }))
        .filter((d) => d.name),
      cycle: cycleByDay.get(dayOf(a)) ?? null,
    };
  });
}

export default { getEpisodeContext };
