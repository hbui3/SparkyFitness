// Sleep stage clustering + aggregate helpers.
//
// Health Connect / HealthKit sync merges stages onto one entry_date. When a
// disconnected block (next-night evening fragment or daytime nap) lands on the
// same row, min(start)→max(end) produces a ~24h History envelope (#1954).
// Cluster by gap (same 4h threshold as the HealthKit mobile aggregator) and
// take the primary (longest asleep) cluster for bedtime/wake/duration.

export const SLEEP_STAGE_CLUSTER_GAP_MS = 4 * 60 * 60 * 1000;

/**
 * Stages that define a partial re-sync's overlap-delete window.
 *
 * `in_bed` / `unknown` are HealthKit envelopes, not scored stages. Apple Health
 * writes one InBed sample covering bedtime→wake, so a 6h observer window still
 * returns that full-night sample. Using it as the merge window would delete
 * every scored stage contained in the night.
 */
export const SLEEP_STAGE_MERGE_WINDOW_TYPES = new Set([
  'awake',
  'rem',
  'light',
  'deep',
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sumAsleepSeconds(stages: any[]): number {
  if (!Array.isArray(stages)) return 0;
  return stages.reduce((sum, stage) => {
    if (
      stage.stage_type === 'deep' ||
      stage.stage_type === 'light' ||
      stage.stage_type === 'rem'
    ) {
      return sum + (Math.round(Number(stage.duration_in_seconds)) || 0);
    }
    return sum;
  }, 0);
}

/**
 * Overlap-delete window for a sleep stage merge payload.
 *
 * Returns null when the payload has no scored/awake stages so a later InBed-only
 * retry cannot wipe previously stored detailed stages.
 */
export function sleepStageMergeWindow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stages: any[]
): { start: Date; end: Date } | null {
  if (!Array.isArray(stages) || stages.length === 0) return null;

  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const stage of stages) {
    const type = String(stage?.stage_type ?? '').toLowerCase();
    if (!SLEEP_STAGE_MERGE_WINDOW_TYPES.has(type)) continue;
    const start = new Date(stage.start_time).getTime();
    const end = new Date(stage.end_time).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start < minStart) minStart = start;
    if (end > maxEnd) maxEnd = end;
  }
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) return null;
  return { start: new Date(minStart), end: new Date(maxEnd) };
}

function stageInstant(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const ms = new Date(String(value)).getTime();
  return ms;
}

/**
 * Portions of a scored stage that sit outside a replacement window.
 *
 * Returns null when the stage is not scored or does not cross the window.
 * Returns [] when the stage is fully inside and should be deleted.
 * A stage that starts before the window and ends inside it is trimmed to the
 * window start; one that covers the window is split in two.
 */
export function scoredStageRemaindersOutsideWindow(
  stage: {
    stage_type?: string;
    start_time: unknown;
    end_time: unknown;
  },
  windowStart: Date,
  windowEnd: Date
): Array<{
  start_time: string;
  end_time: string;
  duration_in_seconds: number;
}> | null {
  const type = String(stage?.stage_type ?? '').toLowerCase();
  if (!SLEEP_STAGE_MERGE_WINDOW_TYPES.has(type)) return null;
  const ss = stageInstant(stage.start_time);
  const se = stageInstant(stage.end_time);
  const ws = windowStart.getTime();
  const we = windowEnd.getTime();
  if (!Number.isFinite(ss) || !Number.isFinite(se) || se <= ss) return null;
  if (!(ss < we && se > ws)) return null;
  if (ss >= ws && se <= we) return [];

  const pieces: Array<{ start: number; end: number }> = [];
  if (ss < ws) pieces.push({ start: ss, end: Math.min(se, ws) });
  if (se > we) pieces.push({ start: Math.max(ss, we), end: se });
  return pieces
    .filter((piece) => piece.end > piece.start)
    .map((piece) => ({
      start_time: new Date(piece.start).toISOString(),
      end_time: new Date(piece.end).toISOString(),
      duration_in_seconds: Math.max(
        0,
        Math.round((piece.end - piece.start) / 1000)
      ),
    }));
}

function stageBoundaryKey(start: unknown, end: unknown): string {
  return `${new Date(stageInstant(start)).toISOString()}|${new Date(stageInstant(end)).toISOString()}`;
}

/**
 * In-memory form of the overlap delete plus boundary trim. Fully contained
 * stages are dropped unless the incoming payload keeps that exact interval.
 * Scored stages that cross the window are trimmed or split so the replacement
 * does not overlap them.
 */
export function reconcileStoredStagesForMerge<
  T extends {
    stage_type?: string;
    start_time: unknown;
    end_time: unknown;
    duration_in_seconds?: number;
  },
>(
  stored: T[],
  incoming: Array<{ start_time: unknown; end_time: unknown }>,
  window: { start: Date; end: Date } | null
): T[] {
  if (!window) return stored;
  const kept = new Set(
    incoming.map((stage) => stageBoundaryKey(stage.start_time, stage.end_time))
  );
  const ws = window.start.getTime();
  const we = window.end.getTime();
  const next: T[] = [];
  for (const stage of stored) {
    if (kept.has(stageBoundaryKey(stage.start_time, stage.end_time))) {
      next.push(stage);
      continue;
    }
    const ss = stageInstant(stage.start_time);
    const se = stageInstant(stage.end_time);
    if (ss >= ws && se <= we) continue;
    const remainders = scoredStageRemaindersOutsideWindow(
      stage,
      window.start,
      window.end
    );
    if (remainders === null) {
      next.push(stage);
      continue;
    }
    for (const piece of remainders) {
      next.push({
        ...stage,
        start_time: piece.start_time,
        end_time: piece.end_time,
        duration_in_seconds: piece.duration_in_seconds,
      });
    }
  }
  return next;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clusterSleepStagesByGap(
  stages: any[],
  gapMs = SLEEP_STAGE_CLUSTER_GAP_MS
) {
  if (!Array.isArray(stages) || stages.length === 0) return [];
  const sorted = [...stages].sort(
    (a, b) =>
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clusters: any[][] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any[] = [sorted[0]];
  let clusterEnd = new Date(sorted[0].end_time).getTime();
  for (let i = 1; i < sorted.length; i++) {
    const stage = sorted[i];
    const startMs = new Date(stage.start_time).getTime();
    const endMs = new Date(stage.end_time).getTime();
    if (startMs - clusterEnd > gapMs) {
      clusters.push(current);
      current = [stage];
      clusterEnd = endMs;
    } else {
      current.push(stage);
      if (endMs > clusterEnd) clusterEnd = endMs;
    }
  }
  clusters.push(current);
  return clusters;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sleepStageEnvelopeSeconds(stages: any[]) {
  if (!stages || stages.length === 0) return 0;
  let minStart = new Date(stages[0].start_time).getTime();
  let maxEnd = new Date(stages[0].end_time).getTime();
  for (const s of stages) {
    const startMs = new Date(s.start_time).getTime();
    const endMs = new Date(s.end_time).getTime();
    if (startMs < minStart) minStart = startMs;
    if (endMs > maxEnd) maxEnd = endMs;
  }
  return Math.max(0, Math.round((maxEnd - minStart) / 1000));
}

// Prefer the longest asleep block; tie-break on envelope duration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPrimarySleepStageCluster(stages: any[]) {
  const clusters = clusterSleepStagesByGap(stages);
  if (clusters.length === 0) return [];
  if (clusters.length === 1) return clusters[0];
  let best = clusters[0];
  let bestAsleep = sumAsleepSeconds(best);
  let bestEnvelope = sleepStageEnvelopeSeconds(best);
  for (let i = 1; i < clusters.length; i++) {
    const candidate = clusters[i];
    const asleep = sumAsleepSeconds(candidate);
    const envelope = sleepStageEnvelopeSeconds(candidate);
    if (
      asleep > bestAsleep ||
      (asleep === bestAsleep && envelope > bestEnvelope)
    ) {
      best = candidate;
      bestAsleep = asleep;
      bestEnvelope = envelope;
    }
  }
  return best;
}

// Aggregates from the primary cluster only. Within one night, partial re-sync
// gaps stay under the 4h threshold so #1180 union behavior is preserved.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function recomputeSleepAggregatesFromStages(stages: any[]) {
  const primary = getPrimarySleepStageCluster(stages);
  if (!primary || primary.length === 0) {
    return {
      bedtime: null,
      wake_time: null,
      duration_in_seconds: 0,
      time_asleep_in_seconds: 0,
      deep_sleep_seconds: 0,
      light_sleep_seconds: 0,
      rem_sleep_seconds: 0,
      awake_sleep_seconds: 0,
    };
  }
  let minStart = new Date(primary[0].start_time).getTime();
  let maxEnd = new Date(primary[0].end_time).getTime();
  let deep = 0;
  let light = 0;
  let rem = 0;
  let awake = 0;
  for (const s of primary) {
    const startMs = new Date(s.start_time).getTime();
    const endMs = new Date(s.end_time).getTime();
    if (startMs < minStart) minStart = startMs;
    if (endMs > maxEnd) maxEnd = endMs;
    const duration = Math.round(Number(s.duration_in_seconds)) || 0;
    switch (s.stage_type) {
      case 'deep':
        deep += duration;
        break;
      case 'light':
        light += duration;
        break;
      case 'rem':
        rem += duration;
        break;
      case 'awake':
        awake += duration;
        break;
      default:
        break;
    }
  }
  const durationInSeconds = Math.max(0, Math.round((maxEnd - minStart) / 1000));
  const timeAsleep = sumAsleepSeconds(primary);
  return {
    bedtime: new Date(minStart),
    wake_time: new Date(maxEnd),
    duration_in_seconds: durationInSeconds,
    time_asleep_in_seconds: timeAsleep,
    deep_sleep_seconds: deep,
    light_sleep_seconds: light,
    rem_sleep_seconds: rem,
    awake_sleep_seconds: awake,
  };
}
