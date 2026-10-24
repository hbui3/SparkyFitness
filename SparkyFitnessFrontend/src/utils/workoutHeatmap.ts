// Day-string maths for the Reports workout heatmap (#2461): twelve calendar
// months ending with today's month, independent of the report's date filter.

const MONTHS_SHOWN = 12;

interface HeatmapMonth {
  year: number;
  /** 0-based month. */
  month: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
export const dayString = (year: number, month: number, day: number) =>
  `${year}-${pad2(month + 1)}-${pad2(day)}`;

export function heatmapMonthsEndingAt(today: string): HeatmapMonth[] {
  const [year, month] = today.split('-').map(Number);
  const months: HeatmapMonth[] = [];
  for (let i = MONTHS_SHOWN - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1 - i, 1));
    months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() });
  }
  return months;
}

/**
 * The fixed window the heatmap always covers: the first day of the month
 * eleven months back through `today` (a YYYY-MM-DD in the user's timezone).
 * Independent of the report's date filter (#2461).
 */
export function workoutHeatmapWindow(today: string): {
  start: string;
  end: string;
} {
  const first = heatmapMonthsEndingAt(today)[0];
  return {
    start: first ? dayString(first.year, first.month, 1) : today,
    end: today,
  };
}
