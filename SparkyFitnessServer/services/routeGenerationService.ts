import {
  ROUTE_MAX_CUES,
  type GeneratedRoutePreview,
  type GenerateRouteBody,
  type RouteCue,
} from '@workspace/shared';
import { prepareRoute } from '../utils/routePrep.js';
import {
  INITIAL_WINDING_FACTOR,
  planLoop,
  planOutAndBack,
  scaleFromResult,
} from './routing/loopPlanner.js';
import {
  RoutingProviderError,
  type LatLon,
  type RoutingProvider,
  type RoutingResult,
} from './routing/routingProvider.js';

/** How close to the target a loop must land to stop trying. */
const DISTANCE_TOLERANCE = 0.1;
/** Calls to the engine one loop request may spend finding the right size. */
const MAX_LOOP_ATTEMPTS = 3;

const ACTIVITY_LABEL = { run: 'run', walk: 'walk', ride: 'ride', hike: 'hike' };

function defaultName(
  activity: GenerateRouteBody['activity'],
  distanceM: number
): string {
  return `Generated ${(distanceM / 1000).toFixed(1)} km ${ACTIVITY_LABEL[activity]}`;
}

/** Keeps the cue list inside what the save endpoint accepts. */
function limitCues(cues: RouteCue[]): RouteCue[] {
  if (cues.length <= ROUTE_MAX_CUES) return cues;
  const significant = cues.filter((cue) => cue.kind !== 'straight');
  return significant.slice(0, ROUTE_MAX_CUES);
}

async function generateLoop(
  provider: RoutingProvider,
  body: Extract<GenerateRouteBody, { mode: 'loop' }>
): Promise<RoutingResult> {
  const bearing = body.bearingDeg ?? Math.random() * 360;
  const plan = body.shape === 'out_and_back' ? planOutAndBack : planLoop;
  let windingFactor = INITIAL_WINDING_FACTOR;
  let best: RoutingResult | null = null;

  for (let attempt = 0; attempt < MAX_LOOP_ATTEMPTS; attempt++) {
    const locations: LatLon[] = plan(
      body.start,
      body.distanceM,
      bearing,
      windingFactor
    );
    const result = await provider.route({
      locations,
      activity: body.activity,
    });
    const error = Math.abs(result.distanceM - body.distanceM);
    if (!best || error < Math.abs(best.distanceM - body.distanceM)) {
      best = result;
    }
    if (error / body.distanceM <= DISTANCE_TOLERANCE) break;
    windingFactor = scaleFromResult(
      windingFactor,
      body.distanceM,
      result.distanceM
    );
  }
  // MAX_LOOP_ATTEMPTS > 0, so a result exists or provider.route threw.
  return best as RoutingResult;
}

/**
 * Generates a preview route (nothing is stored). Provider failures surface as
 * `RoutingProviderError`; a result too short to save as `InvalidRouteError`.
 */
export async function generateRoute(
  provider: RoutingProvider,
  body: GenerateRouteBody
): Promise<GeneratedRoutePreview> {
  const result =
    body.mode === 'loop'
      ? await generateLoop(provider, body)
      : await provider.route({
          locations: [
            body.start,
            ...body.waypoints,
            ...(body.returnToStart ? [body.start] : []),
          ],
          activity: body.activity,
        });

  if (result.points.length < 2) {
    throw new RoutingProviderError('no_route', 'No route could be found');
  }

  // Thin and measure exactly as a save would, so the preview matches what the
  // client gets back after saving it.
  const prepared = prepareRoute(result.points, result.cues);
  return {
    name: body.name ?? defaultName(body.activity, prepared.distanceM),
    activity: body.activity,
    source: 'generated',
    points: prepared.points,
    cues: limitCues(prepared.cues),
    distanceM: prepared.distanceM,
    elevationGainM: prepared.elevationGainM,
  };
}
