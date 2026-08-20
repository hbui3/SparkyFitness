const MIN_FULL_SLEEP_SECONDS = 3 * 60 * 60;
const MAX_PLAUSIBLE_SLEEP_SECONDS = 16 * 60 * 60;
const IGNORED_SLEEP_SOURCES = new Set(['withings']);

export interface CanonicalSleepCandidate {
  entry_date: Date | string;
  duration_in_seconds: number | string | null;
  time_asleep_in_seconds: number | string | null;
  sleep_score: number | string | null;
  source: string | null;
  updated_at: Date | string | null;
}

function finiteNumber(value: number | string | null): number | null {
  if (value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function validSleepScore(value: number | string | null): boolean {
  const score = finiteNumber(value);
  return score !== null && score > 0 && score <= 100;
}

function isFullSleepDuration(value: number | string | null): boolean {
  const seconds = finiteNumber(value);
  return (
    seconds !== null &&
    seconds >= MIN_FULL_SLEEP_SECONDS &&
    seconds <= MAX_PLAUSIBLE_SLEEP_SECONDS
  );
}

function qualityScore(candidate: CanonicalSleepCandidate): number {
  const duration = finiteNumber(candidate.duration_in_seconds);
  const timeAsleep = finiteNumber(candidate.time_asleep_in_seconds);
  const inconsistentDurations =
    duration !== null && timeAsleep !== null && timeAsleep > duration + 60;
  return (
    (validSleepScore(candidate.sleep_score) ? 2 : 0) +
    (isFullSleepDuration(candidate.time_asleep_in_seconds) ? 2 : 0) +
    (isFullSleepDuration(candidate.duration_in_seconds) ? 1 : 0) -
    (inconsistentDurations ? 2 : 0)
  );
}

function timestamp(value: Date | string | null): number {
  if (value === null) return 0;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function canonicalSleepSeconds(
  candidate: CanonicalSleepCandidate
): number | null {
  const timeAsleep = finiteNumber(candidate.time_asleep_in_seconds);
  if (timeAsleep !== null && timeAsleep > 0) return timeAsleep;
  const duration = finiteNumber(candidate.duration_in_seconds);
  return duration !== null && duration > 0 ? duration : null;
}

export function canonicalSleepScore(
  candidate: CanonicalSleepCandidate
): number | null {
  return validSleepScore(candidate.sleep_score)
    ? finiteNumber(candidate.sleep_score)
    : null;
}

export function selectCanonicalSleepEntry(
  candidates: CanonicalSleepCandidate[]
): CanonicalSleepCandidate | null {
  return (
    candidates
      .filter(
        (candidate) =>
          !IGNORED_SLEEP_SOURCES.has(candidate.source?.toLowerCase() ?? '')
      )
      .sort((first, second) => {
        const qualityDifference = qualityScore(second) - qualityScore(first);
        if (qualityDifference !== 0) return qualityDifference;
        const dateDifference =
          timestamp(second.entry_date) - timestamp(first.entry_date);
        if (dateDifference !== 0) return dateDifference;
        const durationDifference =
          (canonicalSleepSeconds(second) ?? 0) -
          (canonicalSleepSeconds(first) ?? 0);
        if (durationDifference !== 0) return durationDifference;
        return timestamp(second.updated_at) - timestamp(first.updated_at);
      })[0] ?? null
  );
}

export default {
  canonicalSleepScore,
  canonicalSleepSeconds,
  selectCanonicalSleepEntry,
};
