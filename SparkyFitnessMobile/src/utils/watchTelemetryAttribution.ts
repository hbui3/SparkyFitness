/**
 * The watch tags a heart-rate batch with whichever exercise it is showing.
 * A set logged on the phone never moves that cursor, so the whole workout
 * would land on the first exercise. Completion timestamps — from either
 * device — say which set was actually current.
 *
 * A sample belongs to the exercise of the next set completed after it.
 * Time after the last completion belongs to the phone's active set only
 * when that set is still ahead of the last one logged. If the store has
 * gone back to fill a skipped set, the open stretch stays on the exercise
 * that was just completed.
 *
 * Durations include the rest between those completions, same as the watch's
 * own per-exercise windows. Zone time is meant to line up with that, not
 * with the seconds spent actually lifting.
 */

export interface AttributionStep {
  setId: string;
  exerciseEntryId: string;
}

export interface WatchSample {
  t: string;
  bpm: number;
}

export interface AttributedWatchBatch {
  samplesByExercise: Map<string, WatchSample[]>;
  /** Shares of this batch's energy delta. Empty when the batch had none. */
  energyByExercise: Map<string, number>;
  /**
   * Wall-clock minutes each exercise was the current one. Null when the
   * phone's timeline still agrees with the watch, so the watch's own
   * duration should be kept. Once a session has used this, keep using it:
   * a later batch that happens to agree must not let the watch's larger
   * number replace it.
   */
  durationsByExercise: Map<string, number> | null;
}

interface CompletedStep extends AttributionStep {
  at: number;
}

function completedInTimeOrder(
  steps: AttributionStep[],
  completedAtBySetId: Record<string, number>
): CompletedStep[] {
  const order = new Map(steps.map((step, index) => [step.setId, index]));
  return steps
    .flatMap((step) => {
      const at = completedAtBySetId[step.setId];
      return at == null ? [] : [{ ...step, at }];
    })
    .sort(
      (a, b) =>
        a.at - b.at || (order.get(a.setId) ?? 0) - (order.get(b.setId) ?? 0)
    );
}

function exerciseOfSet(
  steps: AttributionStep[],
  setId: string | null
): string | null {
  if (setId == null) return null;
  return steps.find((step) => step.setId === setId)?.exerciseEntryId ?? null;
}

/**
 * Where the open stretch goes. `completeSet` sends the cursor back to an
 * earlier hole after the last planned set is logged, and that hole is not
 * what the wearer is doing. Use the active set only when it sits after the
 * latest completion in plan order.
 */
function openExercise(
  steps: AttributionStep[],
  completed: CompletedStep[],
  activeSetId: string | null
): string | null {
  const last = completed[completed.length - 1];
  const active = exerciseOfSet(steps, activeSetId);
  if (!last) return active;
  if (activeSetId == null) return last.exerciseEntryId;
  const activeIndex = steps.findIndex((step) => step.setId === activeSetId);
  const lastIndex = steps.findIndex((step) => step.setId === last.setId);
  if (activeIndex > lastIndex) return active;
  return last.exerciseEntryId;
}

function exerciseEntryAt(
  atMs: number,
  steps: AttributionStep[],
  completed: CompletedStep[],
  activeSetId: string | null,
  fallback: string
): string {
  const next = completed.find((step) => step.at > atMs);
  if (next) return next.exerciseEntryId;
  return (
    openExercise(steps, completed, activeSetId) ??
    steps[0]?.exerciseEntryId ??
    fallback
  );
}

function minutesBetween(startMs: number, endMs: number): number {
  return Math.max(0, endMs - startMs) / 60_000;
}

function addMinutes(
  totals: Map<string, number>,
  exerciseEntryId: string,
  startMs: number,
  endMs: number
): void {
  const minutes = minutesBetween(startMs, endMs);
  if (minutes <= 0) return;
  const rounded = Math.round(minutes * 100) / 100;
  totals.set(
    exerciseEntryId,
    Math.round(((totals.get(exerciseEntryId) ?? 0) + rounded) * 100) / 100
  );
}

/**
 * Minutes each exercise was current, in completion order. A completion
 * earlier than the cursor (a resumed workout, or a duration edit that
 * moved the start later) does not pull the cursor backwards.
 */
function durationsFromTimeline(
  steps: AttributionStep[],
  completed: CompletedStep[],
  startedAt: number,
  now: number,
  activeSetId: string | null
): Map<string, number> {
  const totals = new Map<string, number>();
  let cursor = startedAt;
  for (const step of completed) {
    const end = Math.max(cursor, step.at);
    addMinutes(totals, step.exerciseEntryId, cursor, end);
    cursor = end;
  }
  const open = openExercise(steps, completed, activeSetId);
  if (open) addMinutes(totals, open, cursor, now);
  return totals;
}

/**
 * How far past the phone's own clock a watch tap time may read. The two
 * clocks sync from the same source, so a legitimate gap is seconds.
 */
const WATCH_CLOCK_SKEW_MS = 2 * 60_000;

/**
 * The watch's tap time for a set, bounded to the live workout, or undefined
 * so the phone stamps its own clock.
 *
 * The watch time decides which exercise heart rate is credited to and how
 * long each exercise ran, so it is only used when it falls between the
 * workout's start and now. A time slightly ahead of now (clock drift) is
 * pulled back to now; anything further outside the workout is ignored.
 */
export function boundedWatchCompletedAt(
  completedAt: string | null | undefined,
  startedAt: number | null,
  now: number
): number | undefined {
  if (completedAt == null) return undefined;
  const at = Date.parse(completedAt);
  if (!Number.isFinite(at)) return undefined;
  if (startedAt != null && at < startedAt) return undefined;
  if (at > now + WATCH_CLOCK_SKEW_MS) return undefined;
  return Math.min(at, now);
}

export function attributeWatchBatch(input: {
  samples: WatchSample[];
  activeEnergyKcal?: number | null;
  taggedExerciseEntryId: string;
  steps: AttributionStep[];
  completedAtBySetId: Record<string, number>;
  startedAt: number | null;
  /** The set the phone is on. Used for the open stretch only when it is still ahead of the last set logged. */
  activeSetId: string | null;
  now: number;
  /** Keep the timeline even when this batch agrees with the watch. */
  forceTimeline?: boolean;
}): AttributedWatchBatch {
  const { samples, taggedExerciseEntryId, steps, startedAt, activeSetId, now } =
    input;
  const completed = completedInTimeOrder(steps, input.completedAtBySetId);
  const samplesByExercise = new Map<string, WatchSample[]>();
  const push = (exerciseEntryId: string, sample: WatchSample) => {
    const list = samplesByExercise.get(exerciseEntryId);
    if (list) list.push(sample);
    else samplesByExercise.set(exerciseEntryId, [sample]);
  };

  let moved = false;
  for (const sample of samples) {
    const atMs = Date.parse(sample.t);
    const exerciseEntryId =
      steps.length > 0 && Number.isFinite(atMs)
        ? exerciseEntryAt(
            atMs,
            steps,
            completed,
            activeSetId,
            taggedExerciseEntryId
          )
        : taggedExerciseEntryId;
    if (exerciseEntryId !== taggedExerciseEntryId) moved = true;
    push(exerciseEntryId, sample);
  }

  const current =
    steps.length > 0
      ? exerciseEntryAt(
          now,
          steps,
          completed,
          activeSetId,
          taggedExerciseEntryId
        )
      : taggedExerciseEntryId;
  const durationsByExercise =
    startedAt != null &&
    steps.length > 0 &&
    (moved || current !== taggedExerciseEntryId || input.forceTimeline)
      ? durationsFromTimeline(steps, completed, startedAt, now, activeSetId)
      : null;

  const energyByExercise = new Map<string, number>();
  const kcal = input.activeEnergyKcal;
  if (typeof kcal === 'number' && Number.isFinite(kcal) && samples.length > 0) {
    // By sample count, not by the gaps between them. Samples are usually a
    // few seconds apart, so this is close to a time split without treating
    // one long gap as most of the batch's calories.
    const groups = [...samplesByExercise.entries()];
    let assigned = 0;
    groups.forEach(([exerciseEntryId, group], index) => {
      const share =
        index === groups.length - 1
          ? Math.round((kcal - assigned) * 100) / 100
          : Math.round(((kcal * group.length) / samples.length) * 100) / 100;
      assigned = Math.round((assigned + share) * 100) / 100;
      if (share !== 0) energyByExercise.set(exerciseEntryId, share);
    });
  } else if (typeof kcal === 'number' && Number.isFinite(kcal)) {
    energyByExercise.set(taggedExerciseEntryId, kcal);
  }

  return { samplesByExercise, energyByExercise, durationsByExercise };
}
