import type { IGPSportRegion } from '@workspace/shared';

export const IGPSPORT_BASE_URLS: Record<IGPSportRegion, string> = {
  Global: 'https://prod.en.igpsport.com',
  China: 'https://prod.zh.igpsport.com',
};

export const DEFAULT_IGPSPORT_REGION: IGPSportRegion = 'Global';

export function igpsportBaseUrlForRegion(region: IGPSportRegion): string {
  return IGPSPORT_BASE_URLS[region];
}

export function igpsportRegionFromBaseUrl(
  baseUrl: string | null | undefined
): IGPSportRegion {
  if (!baseUrl) return DEFAULT_IGPSPORT_REGION;

  let normalized: string;
  try {
    const parsed = new URL(baseUrl);
    normalized = parsed.origin;
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('iGPSPORT API URL must not include a path or query.');
    }
  } catch {
    throw new Error('Unsupported iGPSPORT region endpoint.');
  }

  const match = Object.entries(IGPSPORT_BASE_URLS).find(
    ([, allowedUrl]) => allowedUrl === normalized
  );
  if (!match) throw new Error('Unsupported iGPSPORT region endpoint.');
  return match[0] as IGPSportRegion;
}

export function normalizeIGPSportBaseUrl(
  baseUrl: string | null | undefined
): string {
  return igpsportBaseUrlForRegion(igpsportRegionFromBaseUrl(baseUrl));
}
