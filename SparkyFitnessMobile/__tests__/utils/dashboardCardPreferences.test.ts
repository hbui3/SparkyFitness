import { DASHBOARD_CARD_KEYS } from '../../src/constants/dashboardCards';
import { resolveDashboardCardOrder } from '../../src/utils/dashboardCardPreferences';

describe('resolveDashboardCardOrder', () => {
  test('returns saved order verbatim when complete', () => {
    const savedOrder = [...DASHBOARD_CARD_KEYS].reverse();
    expect(resolveDashboardCardOrder(savedOrder)).toEqual(savedOrder);
  });

  test('appends newly added registry keys', () => {
    const partial = ['fasting', 'hydration', 'caffeine'];
    const resolved = resolveDashboardCardOrder(partial);

    expect(resolved.slice(0, 3)).toEqual(partial);
    expect(resolved).toHaveLength(DASHBOARD_CARD_KEYS.length);
  });

  test('drops invalid/stale keys', () => {
    const withGhost = ['fasting', 'ghostCard', 'hydration'];
    const resolved = resolveDashboardCardOrder(withGhost);

    expect(resolved).not.toContain('ghostCard');
    expect(resolved).toHaveLength(DASHBOARD_CARD_KEYS.length);
  });

  test('de-duplicates duplicate keys', () => {
    const dupes = ['fasting', 'fasting', 'hydration'];
    const resolved = resolveDashboardCardOrder(dupes);

    expect(resolved.filter((k) => k === 'fasting')).toHaveLength(1);
    expect(resolved).toHaveLength(DASHBOARD_CARD_KEYS.length);
  });

  test('returns default order for null or empty input', () => {
    expect(resolveDashboardCardOrder([])).toEqual([...DASHBOARD_CARD_KEYS]);
    expect(resolveDashboardCardOrder(null)).toEqual([...DASHBOARD_CARD_KEYS]);
  });
});
