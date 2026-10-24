import type { WatchGoalNutrientPayload } from '../../modules/watch-connectivity';
import { NUTRIENT_META, getNutrientLabel } from '../constants/nutrients';
import type { DailySummary } from '../types/dailySummary';
import { dayCustomNutrient, dayStandardNutrient } from './nutrientUtils';

type Translator = (key: string, options: { defaultValue: string }) => string;

/**
 * Standard nutrients the watch's Goals page can list. Calories are the ring
 * above the rows, and the glycemic index is a category rather than an amount,
 * so neither can be a row.
 */
export const WATCH_STANDARD_NUTRIENT_KEYS = Object.keys(NUTRIENT_META).filter(
  (key) => key !== 'calories' && key !== 'glycemic_index'
);

/**
 * The shown keys, in the saved order. A shown key the order doesn't mention
 * yet goes on the end, in the order it was turned on.
 */
export function shownInOrder(
  order: readonly string[],
  shown: readonly string[]
): string[] {
  return [
    ...order.filter((key) => shown.includes(key)),
    ...shown.filter((key) => !order.includes(key)),
  ];
}

/**
 * The Goals page's rows for the day: each nutrient's amount, goal and fill,
 * labelled and in the wearer's order. A key that is neither a standard
 * nutrient nor one of `customUnits` (a custom nutrient since deleted) is
 * dropped rather than shown as a zero.
 */
export function buildWatchGoalNutrients(
  summary: DailySummary,
  keys: readonly string[],
  customUnits: ReadonlyMap<string, string>,
  t: Translator
): WatchGoalNutrientPayload[] {
  return keys.flatMap((key) => {
    const meta = WATCH_STANDARD_NUTRIENT_KEYS.includes(key)
      ? NUTRIENT_META[key]
      : undefined;
    const customUnit = customUnits.get(key);
    if (!meta && customUnit === undefined) return [];
    const { consumed, goal } = meta
      ? dayStandardNutrient(summary, key)
      : dayCustomNutrient(summary, key);
    return [
      {
        key,
        label: meta ? getNutrientLabel(t, key) : key,
        unit: meta ? meta.unit : customUnit || 'g',
        consumed,
        goal: goal ?? null,
        progress: goal ? Math.max(0, Math.min(1, consumed / goal)) : 0,
      },
    ];
  });
}
