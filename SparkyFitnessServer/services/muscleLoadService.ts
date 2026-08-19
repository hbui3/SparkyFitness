import {
  daysBetween,
  type AdaptiveTrainingMuscleLoad,
} from '@workspace/shared';

export interface MuscleLoadWorkoutRow {
  entryDate: string;
  primaryMuscles: unknown;
  secondaryMuscles: unknown;
  volumeKg: number;
  durationMinutes: number;
  setCount: number;
  source: string | null;
}

interface MutableMuscleLoad {
  muscle: string;
  loadScore: number;
  lastTrainedOn: string | null;
  recentVolumeKg: number;
  recentSets: number;
  sources: Set<string>;
}

export function parseMuscleNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    return parseMuscleNames(JSON.parse(value) as unknown);
  } catch {
    return value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }
}

export function muscleLoadStatus(
  score: number
): AdaptiveTrainingMuscleLoad['status'] {
  if (score >= 80) return 'high';
  if (score >= 55) return 'moderate';
  if (score >= 30) return 'light';
  return 'ready';
}

function exerciseStimulus(row: MuscleLoadWorkoutRow): number {
  if (row.volumeKg > 0) {
    return Math.min(
      100,
      Math.log1p(row.volumeKg) * 9 + Math.min(row.setCount, 8) * 3
    );
  }
  return Math.min(
    70,
    row.durationMinutes * 1.3 + Math.min(row.setCount, 8) * 4
  );
}

export function calculateMuscleLoad(
  rows: MuscleLoadWorkoutRow[],
  today: string,
  recoveryWindowHours: number
): AdaptiveTrainingMuscleLoad[] {
  const muscleMap = new Map<string, MutableMuscleLoad>();
  for (const row of rows) {
    const ageHours = Math.max(0, daysBetween(row.entryDate, today) * 24);
    if (ageHours >= recoveryWindowHours) continue;
    const decay = Math.max(0, 1 - ageHours / recoveryWindowHours);
    const stimulus = exerciseStimulus(row) * decay;
    const weightedMuscles = [
      ...parseMuscleNames(row.primaryMuscles).map(
        (muscle) => [muscle, 1] as const
      ),
      ...parseMuscleNames(row.secondaryMuscles).map(
        (muscle) => [muscle, 0.5] as const
      ),
    ];
    for (const [muscle, weight] of weightedMuscles) {
      const current = muscleMap.get(muscle) ?? {
        muscle,
        loadScore: 0,
        lastTrainedOn: null,
        recentVolumeKg: 0,
        recentSets: 0,
        sources: new Set<string>(),
      };
      current.loadScore += stimulus * weight;
      current.recentVolumeKg += row.volumeKg * weight;
      current.recentSets += Math.round(row.setCount * weight);
      if (!current.lastTrainedOn || row.entryDate > current.lastTrainedOn) {
        current.lastTrainedOn = row.entryDate;
      }
      if (row.source) current.sources.add(row.source);
      muscleMap.set(muscle, current);
    }
  }

  return [...muscleMap.values()]
    .map((item) => {
      const loadScore = Math.round(Math.min(100, item.loadScore));
      return {
        muscle: item.muscle,
        loadScore,
        status: muscleLoadStatus(loadScore),
        lastTrainedOn: item.lastTrainedOn,
        recentVolumeKg: Math.round(item.recentVolumeKg * 10) / 10,
        recentSets: item.recentSets,
        sources: [...item.sources].sort(),
      };
    })
    .sort((first, second) =>
      second.loadScore === first.loadScore
        ? first.muscle.localeCompare(second.muscle)
        : second.loadScore - first.loadScore
    );
}

export default {
  calculateMuscleLoad,
  muscleLoadStatus,
  parseMuscleNames,
};
