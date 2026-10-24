import {
  ROUTING_PROVIDER_TYPE,
  type RouteGenerateCapabilities,
} from '@workspace/shared';
import { log } from '../../config/logging.js';
import externalProviderRepository, {
  type RoutingProviderRow,
} from '../../models/externalProviderRepository.js';
import { resolveIsAdminByUserId } from '../../utils/adminCheck.js';
import { describeError } from '../../utils/errors.js';
import {
  assertOutboundUrlShapeAndLiteralAllowed,
  createGuardedLookup,
  resolveFoodProviderNetworkPolicy,
  resolveHostnameForOutboundConnection,
} from '../../utils/outboundUrlPolicy.js';
import type { RoutingProvider } from './routingProvider.js';
import { createValhallaProvider } from './valhallaProvider.js';

/** How long one call to the engine may take before it is abandoned. */
export const ROUTING_REQUEST_TIMEOUT_MS = 20_000;

/** Where a person's routing engine comes from. */
export type RoutingSource = NonNullable<RouteGenerateCapabilities['source']>;

export interface ResolvedRoutingProvider {
  provider: RoutingProvider;
  source: RoutingSource;
}

/**
 * Builds the engine for a stored routing provider, or null when its URL is
 * not allowed. The URL was checked when it was saved; it is checked again here
 * because the admin's network toggles and DNS can change afterwards, and the
 * connection itself resolves names through the same guard. The policy is the
 * one for the provider's owner, as at save time: an admin's own server may be
 * on the LAN, a non-admin's may not unless the operator allows it.
 */
async function buildProviderFromRow(
  row: RoutingProviderRow
): Promise<RoutingProvider | null> {
  const stored = row.base_url.trim();
  // A scheme-less URL is accepted when it is saved (and read as https), but
  // any other scheme is not a routing server.
  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(stored) &&
    !/^https?:\/\//i.test(stored)
  ) {
    log('warn', `Routing provider ${row.id} is not usable: not an http(s) URL`);
    return null;
  }
  const baseUrl = /^https?:\/\//i.test(stored) ? stored : `https://${stored}`;
  try {
    const isAdmin = await resolveIsAdminByUserId(row.user_id);
    const policy = await resolveFoodProviderNetworkPolicy(isAdmin);
    const url = assertOutboundUrlShapeAndLiteralAllowed(baseUrl, policy);
    await resolveHostnameForOutboundConnection(url.hostname, policy);
    return createValhallaProvider({
      baseUrl,
      apiKey: row.app_key?.trim() || undefined,
      timeoutMs: ROUTING_REQUEST_TIMEOUT_MS,
      lookup: policy.allowPrivateNetwork
        ? undefined
        : createGuardedLookup(policy),
    });
  } catch (error) {
    // Only the message: the provider row carries the API key.
    log(
      'warn',
      `Routing provider ${row.id} is not usable: ${describeError(error)}`
    );
    return null;
  }
}

/**
 * The routing engine this person should use, or null when route generation is
 * off for them: the routing provider they added, or one the admin made public
 * or a family member shared. A new or edited provider applies on the next
 * request; nothing is cached.
 */
export async function resolveRoutingProvider(
  userId: string
): Promise<ResolvedRoutingProvider | null> {
  try {
    const row = await externalProviderRepository.getActiveProviderWithKeyByType(
      userId,
      ROUTING_PROVIDER_TYPE
    );
    if (row) {
      const provider = await buildProviderFromRow(row);
      if (provider) return { provider, source: 'provider' };
    }
  } catch (error) {
    log(
      'warn',
      `Could not look up the routing provider: ${describeError(error)}`
    );
  }
  return null;
}

/**
 * What this person's routing engine supports, as `GET /generate/capabilities`
 * reports it. The engine returns one route per request, with no style
 * preferences and no stops lookup.
 */
export async function getRouteGenerateCapabilities(
  userId: string
): Promise<RouteGenerateCapabilities> {
  const resolved = await resolveRoutingProvider(userId);
  return {
    available: resolved !== null,
    maxAlternatives: 1,
    style: {
      surface: false,
      hilliness: false,
      avoidSteps: false,
      avoidBusyRoads: false,
    },
    stops: false,
    source: resolved ? resolved.source : null,
  };
}
