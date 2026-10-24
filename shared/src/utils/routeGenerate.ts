import {
  ROUTE_GENERATE_MAX_DISTANCE_M,
  ROUTE_GENERATE_MAX_WAYPOINTS,
  ROUTE_GENERATE_MIN_DISTANCE_M,
  type GenerateRouteBody,
  type RouteCue,
  type RoutePoint,
} from '../schemas/api/Route.api.zod.ts';

type LatLon = Pick<RoutePoint, 'lat' | 'lon'>;
type RouteActivity = GenerateRouteBody['activity'];
type WaypointsBody = Extract<GenerateRouteBody, { mode: 'waypoints' }>;
type LoopBody = Extract<GenerateRouteBody, { mode: 'loop' }>;

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;

/** The first tap is the start, so a routed line takes this many taps at most. */
export const ROUTE_FOLLOW_ROADS_MAX_POINTS = ROUTE_GENERATE_MAX_WAYPOINTS + 1;

/** Whether one more tap still fits inside what the generate endpoint takes. */
export function canAddFollowRoadsPoint(pointCount: number): boolean {
  return pointCount < ROUTE_FOLLOW_ROADS_MAX_POINTS;
}

/**
 * Keeps at most `max` waypoints, always the first and last, with the rest
 * spread evenly. A list already within `max` is returned unchanged.
 */
export function limitWaypoints<T>(
  waypoints: readonly T[],
  max = ROUTE_GENERATE_MAX_WAYPOINTS
): T[] {
  if (waypoints.length <= max) return [...waypoints];
  if (max <= 1) return waypoints.slice(waypoints.length - Math.max(max, 0));
  const result: T[] = [];
  for (let i = 0; i < max; i++) {
    result.push(
      waypoints[Math.round((i * (waypoints.length - 1)) / (max - 1))] as T
    );
  }
  return result;
}

/**
 * Turns ordered taps into a waypoints-mode generate request: the first tap is
 * the start and the rest are waypoints. Null until there are two taps.
 */
export function buildFollowRoadsRequest(
  taps: readonly LatLon[],
  activity: RouteActivity = 'run'
): WaypointsBody | null {
  const [start, ...rest] = taps;
  if (!start || rest.length === 0) return null;
  return {
    mode: 'waypoints',
    start: { lat: start.lat, lon: start.lon },
    activity,
    waypoints: limitWaypoints(rest).map((p) => ({ lat: p.lat, lon: p.lon })),
    returnToStart: false,
  };
}

/** A stable string for the taps, to tell whether a result is still current. */
export function followRoadsKey(
  taps: readonly LatLon[],
  activity: RouteActivity = 'run'
): string {
  return `${activity}|${taps.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join(';')}`;
}

export type RouteGenerateErrorKind =
  | 'noRoute'
  | 'rateLimited'
  | 'engineError'
  | 'timeout'
  | 'notConfigured'
  | 'invalid'
  | 'unknown';

/** Names what an HTTP status from the generate endpoint means. */
export function routeGenerateErrorKind(
  status: number | undefined
): RouteGenerateErrorKind {
  switch (status) {
    case 422:
      return 'noRoute';
    case 429:
      return 'rateLimited';
    case 502:
      return 'engineError';
    case 504:
      return 'timeout';
    case 503:
      return 'notConfigured';
    case 400:
      return 'invalid';
    default:
      return 'unknown';
  }
}

/** Cue kinds that are not a turn. */
const NON_TURN_KINDS = new Set<RouteCue['kind']>([
  'depart',
  'straight',
  'arrive',
]);

/** Cues that are actual turns (not depart, arrive or carry on straight). */
export function routeTurnCues(cues: readonly RouteCue[]): RouteCue[] {
  return cues.filter((cue) => !NON_TURN_KINDS.has(cue.kind));
}

export function countRouteTurns(cues: readonly RouteCue[]): number {
  return routeTurnCues(cues).length;
}

/** The next heading to try: at least a quarter turn away from the last one. */
export function nextBearingDeg(
  previous: number | null,
  random: () => number = Math.random
): number {
  if (previous === null) return Math.floor(random() * 360);
  return Math.floor((previous + 90 + random() * 180) % 360);
}

/** A distance typed in the person's unit, as metres. */
export function routeDistanceToMeters(
  value: number,
  unit: 'km' | 'miles'
): number {
  return value * (unit === 'miles' ? METERS_PER_MILE : METERS_PER_KM);
}

/** The target range for a generated loop, expressed in the person's unit. */
export function generateDistanceRange(unit: 'km' | 'miles'): {
  min: number;
  max: number;
} {
  const perUnit = unit === 'miles' ? METERS_PER_MILE : METERS_PER_KM;
  return {
    min: Math.ceil((ROUTE_GENERATE_MIN_DISTANCE_M / perUnit) * 10) / 10,
    max: Math.floor((ROUTE_GENERATE_MAX_DISTANCE_M / perUnit) * 10) / 10,
  };
}

/**
 * Builds a loop-mode generate request, or null when the distance (typed in the
 * person's unit) is outside what the server accepts.
 */
export function buildLoopRequest(input: {
  start: LatLon;
  activity: RouteActivity;
  shape: LoopBody['shape'];
  distance: number;
  unit: 'km' | 'miles';
  bearingDeg: number;
}): LoopBody | null {
  const distanceM = routeDistanceToMeters(input.distance, input.unit);
  if (
    !Number.isFinite(distanceM) ||
    distanceM < ROUTE_GENERATE_MIN_DISTANCE_M ||
    distanceM > ROUTE_GENERATE_MAX_DISTANCE_M
  ) {
    return null;
  }
  return {
    mode: 'loop',
    start: { lat: input.start.lat, lon: input.start.lon },
    activity: input.activity,
    shape: input.shape,
    distanceM: Math.round(distanceM),
    bearingDeg: input.bearingDeg,
  };
}
