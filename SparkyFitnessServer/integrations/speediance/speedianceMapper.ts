export interface SpeedianceTrainingRecord {
  trainingId: string;
  title: string;
  type: number;
  startTimestamp: number;
  endTimestamp: number | null;
  trainingTime: number;
  calorie: number;
  totalCapacity: number;
  raw: Record<string, unknown>;
}

export interface SpeedianceFinishedSet {
  finishedCount: number;
  targetCount: number;
  capacity: number;
  time: number;
  leftRight: number | null;
  weights: number[];
  leftWeights: number[];
  rightWeights: number[];
  raw: Record<string, unknown>;
}

export interface SpeedianceExerciseDetail {
  actionLibraryName: string;
  actionLibraryGroupId: string | null;
  completionMethod: number | null;
  isLeftRight: boolean;
  totalCapacity: number;
  maxWeight: number | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  finishedReps: SpeedianceFinishedSet[];
  raw: Record<string, unknown>;
}

export interface SpeedianceExerciseMetadata {
  primaryMuscles: string[];
  secondaryMuscles: string[];
}

export interface SparkySpeedianceSet {
  set_number: number;
  set_type: string;
  weight: number | null;
  reps: number | null;
  duration: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  const parsed = numberValue(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => numberValue(item, Number.NaN))
    .filter((item) => Number.isFinite(item));
}

function unixSeconds(value: unknown): number {
  const numeric = numberValue(value);
  return numeric > 10_000_000_000 ? Math.round(numeric / 1000) : numeric;
}

const SPEEDIANCE_MUSCLE_NAMES: Record<string, string> = {
  abs: 'abdominals',
  'back extensors': 'lower back',
  pecs: 'chest',
  quads: 'quadriceps',
  'front delts': 'shoulders',
  'rear delts': 'shoulders',
  'side delts': 'shoulders',
};

function canonicalMuscleName(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim().toLowerCase();
  return SPEEDIANCE_MUSCLE_NAMES[normalized] ?? normalized;
}

function muscleNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.flatMap((item) => {
        if (!isRecord(item)) return [];
        const name = canonicalMuscleName(item.muscleGroupName);
        return name ? [name] : [];
      })
    )
  );
}

/**
 * Converts the action-library metadata used by the Speediance app into the
 * canonical muscle vocabulary already used by SparkyFitness' body map.
 */
export function parseSpeedianceExerciseMetadata(
  payload: unknown
): SpeedianceExerciseMetadata {
  if (!isRecord(payload)) {
    return { primaryMuscles: [], secondaryMuscles: [] };
  }

  const primaryMuscles = muscleNames(payload.mainMuscleGroupList);
  if (primaryMuscles.length === 0) {
    const primary = canonicalMuscleName(payload.mainMuscleGroupName);
    if (primary) primaryMuscles.push(primary);
  }
  const primarySet = new Set(primaryMuscles);
  const secondaryMuscles = muscleNames(payload.auxiliaryMuscleGroupList).filter(
    (muscle) => !primarySet.has(muscle)
  );

  return { primaryMuscles, secondaryMuscles };
}

export function parseSpeedianceTrainingRecords(
  payload: unknown[]
): SpeedianceTrainingRecord[] {
  const records: SpeedianceTrainingRecord[] = [];
  for (const item of payload) {
    if (!isRecord(item)) continue;
    const id = item.trainingId;
    const startTimestamp = unixSeconds(item.startTimestamp);
    if ((typeof id !== 'string' && typeof id !== 'number') || !startTimestamp) {
      continue;
    }
    records.push({
      trainingId: String(id),
      title: stringValue(item.title ?? item.name, 'Speediance Workout'),
      type: numberValue(item.type),
      startTimestamp,
      endTimestamp: item.endTimestamp ? unixSeconds(item.endTimestamp) : null,
      trainingTime: Math.max(0, numberValue(item.trainingTime)),
      calorie: Math.max(0, numberValue(item.calorie)),
      totalCapacity: Math.max(0, numberValue(item.totalCapacity)),
      raw: item,
    });
  }
  return records;
}

function parseFinishedSet(value: unknown): SpeedianceFinishedSet | null {
  if (!isRecord(value)) return null;
  const detail = isRecord(value.trainingInfoDetail)
    ? value.trainingInfoDetail
    : {};
  return {
    finishedCount: Math.max(0, numberValue(value.finishedCount)),
    targetCount: Math.max(0, numberValue(value.targetCount)),
    capacity: Math.max(0, numberValue(value.capacity)),
    time: Math.max(0, numberValue(value.time)),
    leftRight: nullableNumber(value.leftRight),
    weights: numberArray(detail.weights),
    leftWeights: numberArray(detail.leftWeights),
    rightWeights: numberArray(detail.rightWeights),
    raw: value,
  };
}

function repWeight(value: Record<string, unknown>): number | null {
  return nullableNumber(value.weight ?? value.avgWeight);
}

function repSide(value: Record<string, unknown>): 'left' | 'right' | null {
  const side = value.side;
  if (side === 1 || String(side).toLowerCase() === 'left') return 'left';
  if (side === 2 || String(side).toLowerCase() === 'right') return 'right';
  return null;
}

function parseFreeTrainingSet(value: unknown): SpeedianceFinishedSet | null {
  if (!isRecord(value)) return null;
  const summary = isRecord(value.summary) ? value.summary : {};
  const rawReps = Array.isArray(value.rawRepList)
    ? value.rawRepList.filter(isRecord)
    : [];
  const finishedCount = Math.max(
    0,
    numberValue(summary.finishedCount, rawReps.length)
  );
  const weights = rawReps.flatMap((rep) => {
    const weight = repWeight(rep);
    return weight === null ? [] : [weight];
  });
  const sideWeights = (side: 'left' | 'right'): number[] =>
    rawReps.flatMap((rep) => {
      const weight = repWeight(rep);
      return weight !== null && repSide(rep) === side ? [weight] : [];
    });

  return {
    finishedCount,
    targetCount: Math.max(0, numberValue(summary.targetCount, finishedCount)),
    capacity: Math.max(0, numberValue(summary.totalCapacity)),
    time: Math.max(0, numberValue(summary.time)),
    leftRight: nullableNumber(summary.leftRight),
    weights,
    leftWeights: sideWeights('left'),
    rightWeights: sideWeights('right'),
    raw: value,
  };
}

function parseFreeTrainingActions(
  payload: unknown
): SpeedianceExerciseDetail[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.actionList)) return null;
  const actionCount = payload.actionList.filter(isRecord).length;

  return payload.actionList.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const finishedReps = Array.isArray(item.setList)
      ? item.setList
          .map(parseFreeTrainingSet)
          .filter((set): set is SpeedianceFinishedSet => set !== null)
      : [];
    const actionSource =
      typeof item.actionSource === 'string' &&
      item.actionSource.trim() &&
      item.actionSource.toLowerCase() !== 'unknown'
        ? item.actionSource
        : null;
    const libraryId = nullableNumber(item.actionLibraryId);
    const setWeights = finishedReps.flatMap((set) => [
      ...set.weights,
      ...set.leftWeights,
      ...set.rightWeights,
    ]);
    const maxWeight = setWeights.length > 0 ? Math.max(...setWeights) : null;
    const isLeftRight = finishedReps.some(
      (set) =>
        set.leftRight === 1 ||
        set.leftRight === 2 ||
        set.leftWeights.length > 0 ||
        set.rightWeights.length > 0
    );

    return [
      {
        actionLibraryName:
          stringValue(item.actionLibraryName ?? item.actionName, '') ||
          actionSource ||
          (actionCount > 1
            ? `Speediance Free Lift ${index + 1}`
            : 'Speediance Free Lift'),
        actionLibraryGroupId:
          libraryId !== null && libraryId > 0 ? String(libraryId) : null,
        completionMethod: 1,
        isLeftRight,
        totalCapacity: Math.max(
          0,
          numberValue(
            item.totalCapacity,
            finishedReps.reduce((sum, set) => sum + set.capacity, 0)
          )
        ),
        maxWeight,
        primaryMuscles: [],
        secondaryMuscles: [],
        finishedReps,
        raw: item,
      },
    ];
  });
}

function findExerciseArray(payload: unknown): unknown[] {
  const queue: unknown[] = [payload];
  const seen = new Set<object>();
  while (queue.length > 0 && seen.size < 10_000) {
    const item = queue.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    if (Array.isArray(item)) {
      if (
        item.some(
          (entry) =>
            isRecord(entry) &&
            ('finishedReps' in entry ||
              'actionLibraryName' in entry ||
              'actionLibraryGroupId' in entry)
        )
      ) {
        return item;
      }
      queue.push(...item);
    } else {
      queue.push(...Object.values(item));
    }
  }
  return [];
}

export function parseSpeedianceTrainingDetail(
  payload: unknown
): SpeedianceExerciseDetail[] {
  const freeTrainingActions = parseFreeTrainingActions(payload);
  if (freeTrainingActions !== null) return freeTrainingActions;

  return findExerciseArray(payload).flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const finishedReps = Array.isArray(item.finishedReps)
      ? item.finishedReps
          .map(parseFinishedSet)
          .filter((set): set is SpeedianceFinishedSet => set !== null)
      : [];
    const groupId = item.actionLibraryGroupId;
    return [
      {
        actionLibraryName: stringValue(
          item.actionLibraryName ?? item.actionName,
          `Speediance Exercise ${index + 1}`
        ),
        actionLibraryGroupId:
          typeof groupId === 'string' || typeof groupId === 'number'
            ? String(groupId)
            : null,
        completionMethod: nullableNumber(item.completionMethod),
        isLeftRight: numberValue(item.isLeftRight) === 1,
        totalCapacity: Math.max(0, numberValue(item.totalCapacity)),
        maxWeight: nullableNumber(item.maxWeight),
        primaryMuscles: [],
        secondaryMuscles: [],
        finishedReps,
        raw: item,
      },
    ];
  });
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function mapSpeedianceSet(
  set: SpeedianceFinishedSet,
  index: number,
  completionMethod: number | null,
  isLeftRight: boolean
): SparkySpeedianceSet {
  const isTimed = completionMethod === 0;
  let weight: number | null = null;
  if (!isTimed && set.finishedCount > 0 && set.capacity > 0) {
    weight = set.capacity / set.finishedCount;
  } else if (!isTimed) {
    const sideWeights =
      isLeftRight && set.leftRight === 1
        ? set.leftWeights
        : isLeftRight && set.leftRight === 2
          ? set.rightWeights
          : set.weights;
    weight = average(sideWeights);
  }

  const side =
    isLeftRight && set.leftRight === 1
      ? 'Left'
      : isLeftRight && set.leftRight === 2
        ? 'Right'
        : null;

  return {
    set_number: index + 1,
    set_type: side ? `Working Set (${side})` : 'Working Set',
    weight: weight === null ? null : Math.round(weight * 100) / 100,
    reps: isTimed ? null : set.finishedCount || set.targetCount || null,
    duration: isTimed ? Math.round(set.time || set.targetCount) || null : null,
  };
}
