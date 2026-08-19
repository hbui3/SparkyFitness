// Human-friendly names for the provider `source` tags stored on synced rows.
export const SOURCE_LABELS: Record<string, string> = {
  healthkit: 'Apple Health',
  health_connect: 'Health Connect',
  healthconnect: 'Health Connect',
  'health connect': 'Health Connect',
  garmin: 'Garmin',
  garmin_fit: 'Garmin',
  igpsport: 'iGPSPORT',
  speediance: 'Speediance',
  withings: 'Withings',
  fitbit: 'Fitbit',
  googlehealth: 'Google Health',
  'google health': 'Google Health',
  polar: 'Polar',
  oura: 'Oura',
  strava: 'Strava',
  hevy: 'Hevy',
  manual: 'Manual',
  ai_estimate: 'AI estimate',
  local: 'Local',
  imported: 'Imported',
  csv: 'CSV Import',
  csv_import: 'CSV Import',
};

/** Maps a stored `source` tag to a display label, falling back to the raw tag. */
export const prettifySource = (source: string): string =>
  SOURCE_LABELS[source.trim().toLowerCase()] ?? source;

export const prettifySourceList = (source?: string | null): string => {
  if (!source) return '-';
  return source
    .split(',')
    .map((item) => prettifySource(item.trim()))
    .filter(Boolean)
    .join(', ');
};

/** Rows written by the user directly rather than pulled from a provider. */
export const MANUAL_SOURCE = 'manual';

export const isManualSource = (source?: string | null): boolean =>
  (source ?? MANUAL_SOURCE) === MANUAL_SOURCE;
