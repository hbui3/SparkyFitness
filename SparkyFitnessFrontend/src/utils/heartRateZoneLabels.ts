import type { TFunction } from 'i18next';
import type {
  HrZoneMethod,
  MaxHrSource,
  StoredZoneMethod,
} from '@workspace/shared';

export const zoneMethodName = (t: TFunction, method: HrZoneMethod): string => {
  switch (method) {
    case 'heart_rate_reserve':
      return t(
        'settings.heartRateZones.method.heartRateReserve',
        'Heart rate reserve'
      );
    case 'custom':
      return t('settings.heartRateZones.method.custom', 'Custom zones');
    default:
      return t(
        'settings.heartRateZones.method.percentMax',
        '% of max heart rate'
      );
  }
};

export const maxHrSourceLabel = (t: TFunction, source: MaxHrSource): string => {
  switch (source) {
    case 'user':
      return t('settings.heartRateZones.source.user', 'You set it');
    case 'age':
      return t('settings.heartRateZones.source.age', 'From your date of birth');
    case 'observed':
      return t(
        'settings.heartRateZones.source.observed',
        'From the highest heart rate in the workout'
      );
    default:
      return t(
        'settings.heartRateZones.source.fallback',
        'A typical value; add your date of birth or set your own'
      );
  }
};

/**
 * The line a zone chart shows, saying which method the stored time in zone was
 * worked out with. Null for a workout stored before methods were recorded.
 */
export const zoneChartMethodLabel = (
  t: TFunction,
  method: StoredZoneMethod | 'mixed' | null | undefined
): string | null => {
  if (!method) return null;
  if (method === 'device') {
    return t(
      'reports.activityReport.hrZonesDevice',
      'Zones set by your watch or device.'
    );
  }
  if (method === 'mixed') {
    return t(
      'reports.activityReport.hrZonesMixed',
      'Zones were worked out with more than one method. Changing your zone settings does not change past workouts.'
    );
  }
  return t('reports.activityReport.hrZonesMethod', {
    defaultValue:
      'Zones: {{method}}. Changing your zone settings does not change past workouts.',
    method: zoneMethodName(t, method),
  });
};

/** The one method shared by every stored zone row, 'mixed' when they disagree, null when unknown. */
export const storedZoneMethodOf = (
  rows: ReadonlyArray<{ zone_method?: StoredZoneMethod | null }>
): StoredZoneMethod | 'mixed' | null => {
  const methods = new Set(rows.map((row) => row.zone_method ?? null));
  if (methods.size !== 1) return methods.size > 1 ? 'mixed' : null;
  return [...methods][0] ?? null;
};
