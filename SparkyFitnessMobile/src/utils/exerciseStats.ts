import {
  compareDays,
  daysBetween,
  figureKeyForMuscle,
  isDayString,
  muscleKey,
} from '@workspace/shared';

export interface MuscleSetRow {
  /** Figure region key when drawn, otherwise the lower-cased stored name. */
  key: string;
  /** Muscle name to localize (schema name when drawn, stored name otherwise). */
  name: string;
  sets: number;
  onFigure: boolean;
}

/**
 * One row per muscle, largest first. Stored names that tint the same figure
 * region ("Abs" and "Abdominals") are combined, matching what the figure shows.
 */
export function muscleSetRows(
  setsByMuscle: Record<string, number>
): MuscleSetRow[] {
  const rows = new Map<string, MuscleSetRow>();
  for (const [name, sets] of Object.entries(setsByMuscle)) {
    if (!(sets > 0)) continue;
    const figureKey = figureKeyForMuscle(name);
    const key = figureKey ?? muscleKey(name);
    const row = rows.get(key);
    if (row) {
      row.sets += sets;
    } else {
      rows.set(key, {
        key,
        name: figureKey ?? name,
        sets,
        onFigure: figureKey !== null,
      });
    }
  }
  return [...rows.values()].sort(
    (a, b) => b.sets - a.sets || a.name.localeCompare(b.name)
  );
}

export interface MuscleRecoveryRow {
  name: string;
  lastDate: string;
  /** Whole calendar days since `lastDate`, or null for an unparseable date. */
  daysAgo: number | null;
}

/** Muscles by the day they were last trained, most recent first. */
export function muscleRecoveryRows(
  recoveryData: Record<string, string>,
  today: string
): MuscleRecoveryRow[] {
  return Object.entries(recoveryData)
    .map(([name, lastDate]) => ({
      name,
      lastDate,
      daysAgo:
        isDayString(lastDate) && isDayString(today)
          ? daysBetween(lastDate, today)
          : null,
    }))
    .sort(
      (a, b) =>
        compareDays(b.lastDate, a.lastDate) || a.name.localeCompare(b.name)
    );
}

/** Stored muscle → number maps as rows, largest first. */
export function rankedMuscleValues(
  values: Record<string, number>
): { name: string; value: number }[] {
  return Object.entries(values)
    .filter(([, value]) => value > 0)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}
