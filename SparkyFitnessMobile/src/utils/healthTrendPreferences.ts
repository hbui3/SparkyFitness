import {
  HEALTH_TREND_KEYS,
  type HealthTrendKey,
} from '../constants/healthTrends';
import { resolveKeyOrder } from './reorderUtils';

/**
 * The user's saved graph order, reconciled against the current registry (see
 * `resolveKeyOrder`), so registering a new graph never needs a store migration.
 */
export function resolveHealthTrendOrder(
  savedOrder: readonly string[]
): HealthTrendKey[] {
  return resolveKeyOrder(savedOrder, HEALTH_TREND_KEYS);
}

/** The ordered graphs the pager should render, with the user's hidden ones removed. */
export function selectVisibleHealthTrends(
  order: readonly HealthTrendKey[],
  hiddenKeys: readonly string[]
): HealthTrendKey[] {
  return order.filter((key) => !hiddenKeys.includes(key));
}
