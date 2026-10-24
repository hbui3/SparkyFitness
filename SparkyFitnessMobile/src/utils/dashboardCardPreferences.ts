import {
  DASHBOARD_CARD_KEYS,
  type DashboardCardKey,
} from '../constants/dashboardCards';

const isDashboardCardKey = (value: string): value is DashboardCardKey =>
  (DASHBOARD_CARD_KEYS as readonly string[]).includes(value);

/**
 * Reconciles the saved dashboard card order against the current registry.
 *
 * New cards added in future releases are automatically appended to the end of
 * the list. Invalid or duplicate keys from old storage are safely dropped.
 */
export function resolveDashboardCardOrder(
  savedOrder: readonly string[] | undefined | null
): DashboardCardKey[] {
  const resolvedOrder: DashboardCardKey[] = [];
  const seenKeys = new Set<DashboardCardKey>();

  if (Array.isArray(savedOrder)) {
    for (const key of savedOrder) {
      if (!isDashboardCardKey(key) || seenKeys.has(key)) continue;
      seenKeys.add(key);
      resolvedOrder.push(key);
    }
  }

  for (const key of DASHBOARD_CARD_KEYS) {
    if (seenKeys.has(key)) continue;
    resolvedOrder.push(key);
  }

  return resolvedOrder;
}
