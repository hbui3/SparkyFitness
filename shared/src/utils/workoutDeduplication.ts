import { localDateTimeToUtc } from "./timezone.ts";

export interface WorkoutDeduplicationCandidate {
  id: string;
  source?: string | null;
  activityStartedAt?: string | null;
  activityEndedAt?: string | null;
  activityStartedAtLocal?: string | null;
  durationSeconds?: number | null;
}

export interface MirroredWorkoutDuplicate {
  duplicateId: string;
  preferredId: string;
}

interface ActivityTimeWindow {
  startMs: number;
  endMs: number;
}

const MOBILE_MIRROR_SOURCES = new Set([
  "healthkit",
  "health connect",
  "apple health",
]);
const PREFERRED_RAW_SOURCES = new Set([
  "speediance",
  "igpsport",
  "garmin",
  "garmin_fit",
  "strava",
]);
const MINIMUM_OVERLAP_RATIO = 0.8;

function parseInstant(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function candidateWindow(
  candidate: WorkoutDeduplicationCandidate,
  timezone: string,
): ActivityTimeWindow | null {
  const explicitStart = parseInstant(candidate.activityStartedAt);
  let localStart = Number.NaN;
  if (candidate.activityStartedAtLocal) {
    try {
      const minutePrecisionStart = localDateTimeToUtc(
        candidate.activityStartedAtLocal,
        timezone,
      ).getTime();
      const secondsMatch = /T\d{2}:\d{2}:(\d{2}(?:\.\d+)?)/.exec(
        candidate.activityStartedAtLocal,
      );
      localStart = minutePrecisionStart + Number(secondsMatch?.[1] ?? 0) * 1000;
    } catch {
      localStart = Number.NaN;
    }
  }
  const startMs =
    explicitStart ?? (Number.isFinite(localStart) ? localStart : null);
  if (startMs === null) return null;

  const explicitEnd = parseInstant(candidate.activityEndedAt);
  const durationSeconds = Number(candidate.durationSeconds);
  const durationEnd =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? startMs + durationSeconds * 1000
      : null;
  const endMs = explicitEnd ?? durationEnd;
  return endMs !== null && endMs > startMs ? { startMs, endMs } : null;
}

function substantiallyOverlaps(
  first: ActivityTimeWindow,
  second: ActivityTimeWindow,
): boolean {
  const overlapMs =
    Math.min(first.endMs, second.endMs) -
    Math.max(first.startMs, second.startMs);
  if (overlapMs <= 0) return false;
  const shorterDurationMs = Math.min(
    first.endMs - first.startMs,
    second.endMs - second.startMs,
  );
  return (
    shorterDurationMs > 0 &&
    overlapMs / shorterDurationMs >= MINIMUM_OVERLAP_RATIO
  );
}

/**
 * Finds mobile-health mirror copies of workouts imported from a preferred raw
 * provider. Both rows remain stored for provider-specific re-sync/deletion,
 * while read paths can suppress the lower-fidelity mobile copy.
 */
export function findMirroredWorkoutDuplicates(
  candidates: WorkoutDeduplicationCandidate[],
  timezone: string,
): MirroredWorkoutDuplicate[] {
  const preferred = candidates
    .filter((candidate) =>
      PREFERRED_RAW_SOURCES.has(candidate.source?.toLowerCase() ?? ""),
    )
    .map((candidate) => ({
      candidate,
      window: candidateWindow(candidate, timezone),
    }))
    .filter(
      (
        item,
      ): item is {
        candidate: WorkoutDeduplicationCandidate;
        window: ActivityTimeWindow;
      } => item.window !== null,
    );

  const duplicates: MirroredWorkoutDuplicate[] = [];
  for (const candidate of candidates) {
    if (!MOBILE_MIRROR_SOURCES.has(candidate.source?.toLowerCase() ?? "")) {
      continue;
    }
    const window = candidateWindow(candidate, timezone);
    if (!window) continue;
    const match = preferred.find((item) =>
      substantiallyOverlaps(window, item.window),
    );
    if (match) {
      duplicates.push({
        duplicateId: candidate.id,
        preferredId: match.candidate.id,
      });
    }
  }
  return duplicates;
}
