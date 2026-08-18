import type { SpeedianceRegion } from '@workspace/shared';

export const SPEEDIANCE_BASE_URLS: Record<SpeedianceRegion, string> = {
  EU: 'https://euapi.speediance.com',
  Global: 'https://api2.speediance.com',
};

export const DEFAULT_SPEEDIANCE_REGION: SpeedianceRegion = 'EU';

export function speedianceBaseUrlForRegion(region: SpeedianceRegion): string {
  return SPEEDIANCE_BASE_URLS[region];
}

export function speedianceRegionFromBaseUrl(
  baseUrl: string | null | undefined
): SpeedianceRegion {
  if (!baseUrl) return DEFAULT_SPEEDIANCE_REGION;

  let normalized: string;
  try {
    const parsed = new URL(baseUrl);
    normalized = parsed.origin;
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('Speediance API URL must not include a path or query.');
    }
  } catch {
    throw new Error('Unsupported Speediance region endpoint.');
  }

  const match = Object.entries(SPEEDIANCE_BASE_URLS).find(
    ([, allowedUrl]) => allowedUrl === normalized
  );
  if (!match) {
    throw new Error('Unsupported Speediance region endpoint.');
  }

  return match[0] as SpeedianceRegion;
}

export function normalizeSpeedianceBaseUrl(
  baseUrl: string | null | undefined
): string {
  return speedianceBaseUrlForRegion(speedianceRegionFromBaseUrl(baseUrl));
}
