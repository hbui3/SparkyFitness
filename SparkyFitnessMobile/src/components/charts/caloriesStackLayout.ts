import type { CaloriesDataPoint } from '../../types/healthTrends';

/**
 * The math behind the Dashboard calories trend's stacked bars.
 *
 * Split out from the chart for the same reason `sleepTimelineLayout.ts` is: Skia draws
 * nothing assertable under jsdom, so every number the chart needs is computed here where
 * it can be tested, and the component is left to measure, pick colours, and draw.
 */

/** `other` is the slice of a day's logged calories that protein/carbs/fat grams don't
 * account for -- alcohol, a calories-only quick add, or just fiber/rounding drift. Rather
 * than stretch the macro segments to cover it (which would misrepresent how much of each
 * macro was actually eaten), it gets its own neutral segment for the difference. */
export type CaloriesMacroKey = 'protein' | 'carbs' | 'fat' | 'other';

export interface CaloriesStackSegment {
  macro: CaloriesMacroKey;
  calories: number;
}

export interface CaloriesStackDay {
  day: string;
  /** The day's logged calories -- what the bar height and tooltip are driven by, matching
   * the Dashboard's "eaten" figure. The segments below are each macro's true gram-derived
   * calories, plus an `other` segment for whatever's left over, so they always sum to this
   * without inflating any one macro's true size. */
  totalCalories: number;
  /** In `MACRO_SEGMENT_ORDER` (carbs, fat, protein), then `other` last if there's a
   * leftover; the layout stacks these bottom-to-top. */
  segments: CaloriesStackSegment[];
}

const CALORIES_PER_GRAM: Record<'protein' | 'carbs' | 'fat', number> = {
  protein: 4,
  carbs: 4,
  fat: 9,
};

/** Below this, a macro/total mismatch reads as float noise, not a real leftover to draw. */
const LEFTOVER_ROUNDING_TOLERANCE = 0.5;

/** Fixed stacking order, not sorted by size, so a macro's position is predictable day to day. */
const MACRO_SEGMENT_ORDER: readonly ('protein' | 'carbs' | 'fat')[] = [
  'carbs',
  'fat',
  'protein',
];

/**
 * Turns a day's logged calories into stacked segments: each macro at its true gram-derived
 * size, plus an `other` segment for any calories they don't account for -- never scaled up
 * to cover a shortfall, which would draw more of a macro than was actually eaten. The one
 * exception is a macro overshoot (grams whose calorie equivalent exceeds the logged total,
 * e.g. inconsistent food data): there every segment is scaled down instead, since macros
 * are stored independently of the total and can disagree with it in either direction. The
 * segments' sum always equals the day's logged calories either way, which is also the bar
 * height and tooltip total, matching the Dashboard's "eaten" figure and keeping the
 * goal-line comparison honest.
 */
export function buildCaloriesStackDays(
  points: CaloriesDataPoint[]
): CaloriesStackDay[] {
  return points.map((point) => {
    const totalCalories = Math.max(0, point.calories);

    const caloriesByMacro: Record<'protein' | 'carbs' | 'fat', number> = {
      protein: Math.max(0, point.protein) * CALORIES_PER_GRAM.protein,
      carbs: Math.max(0, point.carbs) * CALORIES_PER_GRAM.carbs,
      fat: Math.max(0, point.fat) * CALORIES_PER_GRAM.fat,
    };
    const macroCalories =
      caloriesByMacro.protein + caloriesByMacro.carbs + caloriesByMacro.fat;

    // Macro grams are stored independently of the logged total, not derived from it, so
    // they can overshoot it for real (inconsistent food data, a manual override) as well as
    // just from float rounding. Scaling down here keeps the segments summing to exactly
    // `totalCalories` either way -- the bar height, goal line, and tooltip percentage are
    // all driven by that figure, so letting the segments run ahead of it would draw a bar
    // past the chart's own axis max and report a share over 100%.
    const scale =
      macroCalories > totalCalories ? totalCalories / macroCalories : 1;

    const segments: CaloriesStackSegment[] = MACRO_SEGMENT_ORDER.map(
      (macro) => ({
        macro,
        calories: caloriesByMacro[macro] * scale,
      })
    ).filter((segment) => segment.calories > 0);

    // Below the tolerance, a mismatch reads as float noise rather than a real leftover to
    // draw -- otherwise a day whose macros genuinely do account for the full total could
    // show an invisible sub-calorie `other` sliver (and a stray legend dot for it).
    const leftover = totalCalories - macroCalories * scale;
    if (leftover > LEFTOVER_ROUNDING_TOLERANCE) {
      segments.push({ macro: 'other', calories: leftover });
    }

    return { day: point.day, totalCalories, segments };
  });
}

export interface CaloriesBarBlock {
  y: number;
  height: number;
  macro: CaloriesMacroKey;
}

export interface CaloriesBarColumn {
  dayIndex: number;
  x: number;
  width: number;
  blocks: CaloriesBarBlock[];
}

export interface CaloriesBarLayoutOptions {
  width: number;
  height: number;
  innerPadding: number;
  maxCalories: number;
}

/**
 * Lays the window's days out as evenly spaced columns, each day's segments stacked
 * bottom-to-top in the order given (see `CaloriesStackDay.segments`, from `buildCaloriesStackDays`).
 */
export function buildCaloriesBarLayout(
  days: CaloriesStackDay[],
  { width, height, innerPadding, maxCalories }: CaloriesBarLayoutOptions
): CaloriesBarColumn[] {
  if (width <= 0 || height <= 0 || days.length === 0 || maxCalories <= 0) {
    return [];
  }

  const slotWidth = width / days.length;
  const columnWidth = Math.max(1, slotWidth * (1 - innerPadding));
  const columnInset = (slotWidth - columnWidth) / 2;
  const toY = (calories: number) => (calories / maxCalories) * height;

  return days.map((day, dayIndex) => {
    let cumulative = 0;
    const blocks: CaloriesBarBlock[] = day.segments.map((segment) => {
      const bottomY = height - toY(cumulative);
      cumulative += segment.calories;
      const topY = height - toY(cumulative);
      return {
        y: topY,
        height: Math.max(0, bottomY - topY),
        macro: segment.macro,
      };
    });

    return {
      dayIndex,
      x: dayIndex * slotWidth + columnInset,
      width: columnWidth,
      blocks,
    };
  });
}

/** The highest value the goal line's y-axis needs to reach, so the axis still covers a
 * goal that exceeds every logged day -- the same "nice round scale up to the goal"
 * behavior `TrendBarChart` uses for Steps/Hydration, generalized from one scalar goal to
 * the highest value anywhere in the per-day array. */
export function resolveEffectiveMaxCalories(
  dataMax: number,
  goals: (number | null | undefined)[]
): number {
  const positiveGoals = goals.filter(
    (goal): goal is number => goal != null && goal > 0
  );
  return positiveGoals.length > 0
    ? Math.max(dataMax, ...positiveGoals)
    : dataMax;
}

export interface CaloriesGoalSegment {
  p1: { x: number; y: number };
  p2: { x: number; y: number };
}

/**
 * Builds the dashed goal line's drawable segments: one flat hold per day at that day's
 * resolved goal, plus a vertical riser wherever the value changed -- the Skia-canvas
 * equivalent of `TrendGoalLine`'s `stepAfter` curve, since this chart draws its own
 * columns rather than going through `CartesianChart`. Returns `null` when no day has a
 * usable (positive) goal, matching `TrendGoalLine`'s "draw nothing" rule.
 *
 * Two edge segments extend the first and last resolved values out to the plot's left/right
 * bounds, the same way `TrendGoalLine` extends its own line to the chart edges.
 */
export function buildCaloriesGoalSegments(
  columns: CaloriesBarColumn[],
  goals: (number | null | undefined)[],
  maxCalories: number,
  plotWidth: number,
  plotHeight: number
): CaloriesGoalSegment[] | null {
  if (maxCalories <= 0) {
    return null;
  }

  const yFor = (goal: number) => plotHeight - (goal / maxCalories) * plotHeight;

  const resolved = columns
    .map((column) => ({
      x: column.x + column.width / 2,
      goal: goals[column.dayIndex],
    }))
    .filter(
      (entry): entry is { x: number; goal: number } =>
        entry.goal != null && entry.goal > 0
    );

  if (resolved.length === 0) {
    return null;
  }

  const segments: CaloriesGoalSegment[] = [];
  const firstY = yFor(resolved[0].goal);
  segments.push({
    p1: { x: 0, y: firstY },
    p2: { x: resolved[0].x, y: firstY },
  });

  for (let i = 0; i < resolved.length; i++) {
    const current = resolved[i];
    const currentY = yFor(current.goal);

    if (i < resolved.length - 1) {
      const next = resolved[i + 1];
      const nextY = yFor(next.goal);
      segments.push({
        p1: { x: current.x, y: currentY },
        p2: { x: next.x, y: currentY },
      });
      if (nextY !== currentY) {
        segments.push({
          p1: { x: next.x, y: currentY },
          p2: { x: next.x, y: nextY },
        });
      }
    } else {
      segments.push({
        p1: { x: current.x, y: currentY },
        p2: { x: plotWidth, y: currentY },
      });
    }
  }

  return segments;
}
