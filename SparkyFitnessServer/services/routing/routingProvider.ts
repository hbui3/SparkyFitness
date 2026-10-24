import type { RouteCue, RoutePoint } from '@workspace/shared';

export type RoutingActivity = 'run' | 'walk' | 'ride' | 'hike';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RoutingRequest {
  /** Start, any via points in order, and the finish; at least two. */
  locations: LatLon[];
  activity: RoutingActivity;
}

export interface RoutingResult {
  points: RoutePoint[];
  cues: RouteCue[];
  distanceM: number;
}

export type RoutingFailureKind =
  /** The engine could not be reached. */
  | 'unreachable'
  | 'timeout'
  /** The engine answered but found no route (e.g. start off the map extract). */
  | 'no_route'
  /** The engine refused the request or our credentials. */
  | 'rejected'
  /** The engine answered with something we could not read. */
  | 'bad_response';

export class RoutingProviderError extends Error {
  constructor(
    readonly kind: RoutingFailureKind,
    message: string
  ) {
    super(message);
    this.name = 'RoutingProviderError';
  }
}

/**
 * A routing engine. The endpoint only talks to this interface, so supporting
 * another engine means adding an implementation and a case in `routingConfig`.
 */
export interface RoutingProvider {
  readonly kind: string;
  route(request: RoutingRequest): Promise<RoutingResult>;
}
