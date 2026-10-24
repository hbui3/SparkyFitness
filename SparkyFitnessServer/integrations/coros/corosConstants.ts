export const COROS_PROVIDER_TYPE = 'coros_mcp';

export const COROS_REGIONS = {
  us: 'https://mcpus.coros.com/mcp',
  eu: 'https://mcpeu.coros.com/mcp',
  cn: 'https://mcpcn.coros.com/mcp',
} as const;

export type CorosRegion = keyof typeof COROS_REGIONS;
export const DEFAULT_COROS_MCP_URL = COROS_REGIONS.us;
export const COROS_SCOPE = 'openid offline_access mcp.tools';
export const COROS_ENTRY_SOURCE = 'coros_mcp';
export const COROS_FIT_BUDGET_PER_DAY = 45;
export const COROS_SPORT_RECORDS_PAGE_LIMIT = 100;
export const COROS_SPORT_RECORDS_WINDOW_DAYS = 90;
export const COROS_ALL_SPORTS = [65535];

const ALLOWED_MCP_URLS = new Set<string>(Object.values(COROS_REGIONS));

/**
 * Validates and resolves the COROS MCP regional endpoint URL.
 * Throws an error if baseUrl is non-empty and does not match an allowed COROS region (SSRF guard).
 */
export function resolveCorosMcpUrl(baseUrl: string | null | undefined): string {
  if (!baseUrl || baseUrl.trim() === '') {
    return DEFAULT_COROS_MCP_URL;
  }
  const trimmed = baseUrl.trim();
  if (!ALLOWED_MCP_URLS.has(trimmed)) {
    throw new Error(
      `Invalid COROS MCP URL '${trimmed}'. Allowed URLs: ${Array.from(ALLOWED_MCP_URLS).join(', ')}`
    );
  }
  return trimmed;
}

/**
 * Returns the origin / issuer URL for a given COROS MCP endpoint.
 */
export function corosIssuerFromMcpUrl(url: string): string {
  const resolved = resolveCorosMcpUrl(url);
  return new URL(resolved).origin;
}

export {
  COROS_SPORT_TYPES,
  type CorosSportDefinition,
} from '@workspace/shared';
