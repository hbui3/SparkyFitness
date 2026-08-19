import {
  addDays,
  instantToDay,
  todayInZone,
  type AdaptiveTrainingDashboardResponse,
  type AdaptiveTrainingMuscleLoad,
  type AdaptiveTrainingPreset,
  type AdaptiveTrainingReadiness,
  type AdaptiveTrainingReason,
  type AdaptiveTrainingRecommendation,
  type AdaptiveTrainingSettingsResponse,
  type UpdateAdaptiveTrainingRecommendationStatusRequest,
} from '@workspace/shared';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import adaptiveTrainingRepository, {
  type AdaptiveTrainingPresetRow,
  type AdaptiveTrainingRecommendationRow,
  type AdaptiveTrainingSettingsRow,
} from '../models/adaptiveTrainingRepository.js';
import type { ReportExerciseEntryRow } from '../models/reportRepository.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';
import { getCanonicalWorkoutEntries } from './workoutDeduplicationService.js';
import {
  calculateMuscleLoad,
  parseMuscleNames,
  type MuscleLoadWorkoutRow,
} from './muscleLoadService.js';

const ALGORITHM_VERSION = 'adaptive-v1';
const DEFAULT_SETTINGS: AdaptiveTrainingSettingsResponse = {
  enabled: true,
  sessionsPerWeek: 3,
  maxDurationMinutes: 45,
  recoveryWindowHours: 72,
  preferredMuscles: [],
  candidateWorkoutPresetIds: [],
  avoidConsecutiveTrainingDays: true,
};

interface PresetAccumulator {
  id: number;
  name: string;
  description: string | null;
  exerciseIds: Set<number>;
  primaryMuscles: Set<string>;
  secondaryMuscles: Set<string>;
  totalSeconds: number;
  setCount: number;
}

interface ScoredPreset {
  preset: AdaptiveTrainingPreset;
  score: number;
  rationale: AdaptiveTrainingReason[];
}

const MUSCLE_PREFERENCE_GROUPS: Record<string, Set<string>> = {
  back: new Set([
    'back',
    'lats',
    'latissimus dorsi',
    'middle back',
    'upper back',
    'lower back',
    'back extensors',
    'traps',
    'trapezius',
  ]),
  legs: new Set([
    'legs',
    'quadriceps',
    'quads',
    'hamstrings',
    'glutes',
    'calves',
    'adductors',
    'abductors',
  ]),
  shoulders: new Set([
    'shoulders',
    'delts',
    'front delts',
    'side delts',
    'rear delts',
  ]),
  chest: new Set(['chest', 'pecs']),
  core: new Set(['core', 'abdominals', 'abs', 'obliques']),
};

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function matchesMusclePreference(muscle: string, preference: string): boolean {
  return (
    muscle === preference ||
    MUSCLE_PREFERENCE_GROUPS[preference]?.has(muscle) === true
  );
}

function settingsFromRow(
  row: AdaptiveTrainingSettingsRow | null
): AdaptiveTrainingSettingsResponse {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    enabled: row.enabled,
    sessionsPerWeek: row.sessions_per_week,
    maxDurationMinutes: row.max_duration_minutes,
    recoveryWindowHours: row.recovery_window_hours,
    preferredMuscles: row.preferred_muscles,
    candidateWorkoutPresetIds: row.candidate_workout_preset_ids,
    avoidConsecutiveTrainingDays: row.avoid_consecutive_training_days,
  };
}

function normalizeWorkoutRow(
  row: ReportExerciseEntryRow
): MuscleLoadWorkoutRow {
  const sets = Array.isArray(row.sets) ? row.sets : [];
  const volumeKg = sets.reduce(
    (sum, set) =>
      sum + finiteNumber(set.weight) * Math.max(0, finiteNumber(set.reps)),
    0
  );
  return {
    entryDate: row.entry_date,
    primaryMuscles: row.exercise_primary_muscles,
    secondaryMuscles: row.exercise_secondary_muscles,
    volumeKg,
    durationMinutes: finiteNumber(row.duration_minutes),
    setCount: sets.length,
    source: row.exercise_source,
  };
}

function buildPresets(
  rows: AdaptiveTrainingPresetRow[]
): AdaptiveTrainingPreset[] {
  const byId = new Map<number, PresetAccumulator>();
  for (const row of rows) {
    const accumulator = byId.get(row.preset_id) ?? {
      id: row.preset_id,
      name: row.preset_name,
      description: row.preset_description,
      exerciseIds: new Set<number>(),
      primaryMuscles: new Set<string>(),
      secondaryMuscles: new Set<string>(),
      totalSeconds: 0,
      setCount: 0,
    };
    if (row.preset_exercise_id !== null) {
      accumulator.exerciseIds.add(row.preset_exercise_id);
    }
    for (const muscle of parseMuscleNames(row.primary_muscles)) {
      accumulator.primaryMuscles.add(muscle);
    }
    for (const muscle of parseMuscleNames(row.secondary_muscles)) {
      if (!accumulator.primaryMuscles.has(muscle)) {
        accumulator.secondaryMuscles.add(muscle);
      }
    }
    for (const set of row.sets) {
      accumulator.setCount += 1;
      const duration = finiteNumber(set.duration);
      const rest = finiteNumber(set.rest_time);
      accumulator.totalSeconds +=
        duration > 0 ? duration + rest : 90 + Math.max(rest, 60);
    }
    byId.set(row.preset_id, accumulator);
  }
  return [...byId.values()]
    .filter((preset) => preset.exerciseIds.size > 0)
    .map((preset) => ({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      estimatedDurationMinutes: Math.max(
        10,
        Math.round(preset.totalSeconds / 60)
      ),
      exerciseCount: preset.exerciseIds.size,
      primaryMuscles: [...preset.primaryMuscles].sort(),
      secondaryMuscles: [...preset.secondaryMuscles].sort(),
    }))
    .sort((first, second) => first.name.localeCompare(second.name));
}

function buildReadiness(row: {
  sleep_hours: number | null;
  sleep_score: number | null;
  training_readiness_score: number | null;
}): AdaptiveTrainingReadiness {
  const sleepHours =
    row.sleep_hours === null
      ? null
      : Math.round(Number(row.sleep_hours) * 10) / 10;
  const sleepScore =
    row.sleep_score === null ? null : Math.round(Number(row.sleep_score));
  const trainingReadinessScore =
    row.training_readiness_score === null
      ? null
      : Math.round(Number(row.training_readiness_score));
  const signals: number[] = [];
  if (trainingReadinessScore !== null) signals.push(trainingReadinessScore);
  if (sleepScore !== null) signals.push(sleepScore);
  if (sleepHours !== null) signals.push(clamp((sleepHours - 3) * 22));
  return {
    score:
      signals.length === 0
        ? 70
        : Math.round(
            signals.reduce((sum, signal) => sum + signal, 0) / signals.length
          ),
    sleepHours,
    sleepScore,
    trainingReadinessScore,
  };
}

function strengthSessionKeys(rows: ReportExerciseEntryRow[]): Set<string> {
  return new Set(
    rows
      .filter(
        (row) =>
          parseMuscleNames(row.exercise_primary_muscles).length > 0 ||
          (row.exercise_category ?? '').toLowerCase().includes('strength')
      )
      .map((row) => row.exercise_preset_entry_id ?? row.id)
  );
}

function scorePreset(
  preset: AdaptiveTrainingPreset,
  muscleLoad: AdaptiveTrainingMuscleLoad[],
  settings: AdaptiveTrainingSettingsResponse
): ScoredPreset {
  const loads = new Map(
    muscleLoad.map((item) => [item.muscle, item.loadScore])
  );
  const targetMuscles = [
    ...preset.primaryMuscles.map((muscle) => [muscle, 1] as const),
    ...preset.secondaryMuscles.map((muscle) => [muscle, 0.5] as const),
  ];
  if (targetMuscles.length === 0) {
    return {
      preset,
      score: 15,
      rationale: [
        { code: 'insufficient_muscle_data', muscles: [], value: null },
      ],
    };
  }
  const weightTotal = targetMuscles.reduce(
    (sum, [, weight]) => sum + weight,
    0
  );
  const recoveryScore =
    targetMuscles.reduce(
      (sum, [muscle, weight]) =>
        sum + (100 - (loads.get(muscle) ?? 0)) * weight,
      0
    ) / weightTotal;
  const durationOverage = Math.max(
    0,
    preset.estimatedDurationMinutes - settings.maxDurationMinutes
  );
  const preferred = preset.primaryMuscles.filter((muscle) =>
    settings.preferredMuscles.some((preference) =>
      matchesMusclePreference(muscle, preference)
    )
  );
  const score = Math.round(
    clamp(
      recoveryScore * 0.9 -
        Math.min(30, durationOverage * 1.5) +
        preferred.length * 5
    )
  );
  const readyMuscles = preset.primaryMuscles
    .filter((muscle) => (loads.get(muscle) ?? 0) < 30)
    .slice(0, 4);
  const rationale: AdaptiveTrainingReason[] = [
    {
      code: 'muscles_ready',
      muscles: readyMuscles,
      value: Math.round(recoveryScore),
    },
  ];
  if (preferred.length > 0) {
    rationale.push({
      code: 'preferred_muscles',
      muscles: preferred,
      value: null,
    });
  }
  if (durationOverage === 0) {
    rationale.push({
      code: 'within_duration',
      muscles: [],
      value: preset.estimatedDurationMinutes,
    });
  }
  return { preset, score, rationale };
}

function dayString(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return instantToDay(value, 'UTC');
}

function recommendationFromRow(
  row: AdaptiveTrainingRecommendationRow
): AdaptiveTrainingRecommendation {
  const snapshot = row.workout_snapshot;
  const presetName =
    snapshot && typeof snapshot.name === 'string' ? snapshot.name : null;
  const generatedAt =
    row.generated_at instanceof Date
      ? row.generated_at.toISOString()
      : new Date(row.generated_at).toISOString();
  return {
    id: row.id,
    date: dayString(row.recommendation_date),
    kind: row.kind,
    presetId: row.workout_preset_id,
    presetName,
    score: Math.round(Number(row.score)),
    status: row.status,
    volumeFactor: Number(row.volume_factor),
    rationale: row.rationale,
    algorithmVersion: row.algorithm_version,
    generatedAt,
  };
}

function snapshotsMatch(
  existing: AdaptiveTrainingRecommendationRow | null,
  current: Record<string, unknown>
): boolean {
  return (
    existing !== null &&
    isDeepStrictEqual(existing.muscle_load_snapshot, current)
  );
}

interface DashboardOptions {
  forceRegenerate?: boolean;
  persistRecommendation?: boolean;
}

export async function getAdaptiveTrainingDashboard(
  userId: string,
  authenticatedUserId: string,
  requestedDate?: string,
  options: DashboardOptions = {}
): Promise<AdaptiveTrainingDashboardResponse> {
  const timezone = await loadUserTimezone(userId);
  const date = requestedDate ?? todayInZone(timezone);
  const earliestDate = addDays(date, -6);
  const [settingsRow, presetRows, readinessRow, canonical, existing] =
    await Promise.all([
      adaptiveTrainingRepository.getSettings(userId, authenticatedUserId),
      adaptiveTrainingRepository.getPresetRows(userId, authenticatedUserId),
      adaptiveTrainingRepository.getReadiness(
        userId,
        authenticatedUserId,
        date
      ),
      getCanonicalWorkoutEntries(userId, earliestDate, date),
      adaptiveTrainingRepository.getRecommendation(
        userId,
        authenticatedUserId,
        date
      ),
    ]);
  const allPresets = buildPresets(presetRows);
  const availablePresetIds = new Set(allPresets.map((preset) => preset.id));
  const storedSettings = settingsFromRow(settingsRow);
  const settings = {
    ...storedSettings,
    candidateWorkoutPresetIds: storedSettings.candidateWorkoutPresetIds.filter(
      (presetId) => availablePresetIds.has(presetId)
    ),
  };
  const selectedIds = new Set(settings.candidateWorkoutPresetIds);
  const eligiblePresets =
    selectedIds.size === 0
      ? allPresets
      : allPresets.filter((preset) => selectedIds.has(preset.id));
  const readiness = buildReadiness(readinessRow);
  const muscleLoad = calculateMuscleLoad(
    canonical.workoutEntries.map(normalizeWorkoutRow),
    date,
    settings.recoveryWindowHours
  );
  const weekStrengthSessions = strengthSessionKeys(canonical.workoutEntries);
  const yesterday = addDays(date, -1);
  const trainedYesterday = canonical.workoutEntries.some(
    (row) =>
      row.entry_date === yesterday &&
      (parseMuscleNames(row.exercise_primary_muscles).length > 0 ||
        (row.exercise_category ?? '').toLowerCase().includes('strength'))
  );
  const contextSnapshot: Record<string, unknown> = {
    muscleLoad,
    weekStrengthSessionCount: weekStrengthSessions.size,
    trainedYesterday,
    readiness,
    eligiblePresetIds: eligiblePresets.map((preset) => preset.id),
    settings,
  };

  let recommendationRow = existing;
  if (
    options.forceRegenerate ||
    existing === null ||
    (existing.status === 'planned' &&
      !snapshotsMatch(existing, contextSnapshot))
  ) {
    let kind: 'workout' | 'recovery' = 'workout';
    let workoutPresetId: number | null = null;
    let score = readiness.score;
    let volumeFactor = readiness.score < 60 ? 0.75 : 1;
    let rationale: AdaptiveTrainingReason[];
    let workoutSnapshot: Record<string, unknown> | null = null;

    if (!settings.enabled) {
      kind = 'recovery';
      rationale = [{ code: 'adaptive_disabled', muscles: [], value: null }];
    } else if (weekStrengthSessions.size >= settings.sessionsPerWeek) {
      kind = 'recovery';
      rationale = [
        {
          code: 'weekly_target_reached',
          muscles: [],
          value: weekStrengthSessions.size,
        },
      ];
    } else if (settings.avoidConsecutiveTrainingDays && trainedYesterday) {
      kind = 'recovery';
      rationale = [{ code: 'trained_yesterday', muscles: [], value: null }];
    } else if (readiness.score < 40) {
      kind = 'recovery';
      rationale = [
        { code: 'low_readiness', muscles: [], value: readiness.score },
      ];
    } else if ((readiness.sleepHours ?? 8) < 5) {
      kind = 'recovery';
      rationale = [
        {
          code: 'poor_sleep',
          muscles: [],
          value: readiness.sleepHours,
        },
      ];
    } else if (eligiblePresets.length === 0) {
      kind = 'recovery';
      rationale = [{ code: 'no_eligible_presets', muscles: [], value: null }];
    } else {
      const best = eligiblePresets
        .map((preset) => scorePreset(preset, muscleLoad, settings))
        .sort((first, second) =>
          second.score === first.score
            ? first.preset.id - second.preset.id
            : second.score - first.score
        )[0];
      if (!best || best.score < 35) {
        kind = 'recovery';
        score = best?.score ?? readiness.score;
        rationale = best?.rationale ?? [
          { code: 'no_eligible_presets', muscles: [], value: null },
        ];
      } else {
        score = best.score;
        volumeFactor = Math.min(
          volumeFactor,
          best.score < 50 ? 0.6 : best.score < 70 ? 0.75 : 1
        );
        workoutPresetId = best.preset.id;
        rationale = best.rationale;
        workoutSnapshot = { ...best.preset };
      }
    }
    if (kind === 'recovery') {
      volumeFactor = 0.5;
    }
    const recommendationInput = {
      date,
      kind,
      workoutPresetId,
      score,
      volumeFactor,
      muscleLoadSnapshot: contextSnapshot,
      workoutSnapshot,
      rationale,
      settingsSnapshot: settings,
      algorithmVersion: ALGORITHM_VERSION,
    };
    if (options.persistRecommendation === false) {
      recommendationRow = {
        id: randomUUID(),
        recommendation_date: date,
        kind,
        workout_preset_id: workoutPresetId,
        status: 'planned',
        score,
        volume_factor: volumeFactor,
        muscle_load_snapshot: contextSnapshot,
        workout_snapshot: workoutSnapshot,
        rationale,
        algorithm_version: ALGORITHM_VERSION,
        generated_at: new Date(),
      };
    } else {
      recommendationRow = await adaptiveTrainingRepository.saveRecommendation(
        userId,
        authenticatedUserId,
        recommendationInput
      );
    }
  }

  if (!recommendationRow) {
    throw new Error('Adaptive training recommendation could not be generated.');
  }
  return {
    date,
    settings,
    readiness,
    muscleLoad,
    recommendation: recommendationFromRow(recommendationRow),
    availablePresets: allPresets,
    hiddenDuplicateWorkouts: canonical.duplicateSummary.hiddenCount,
  };
}

export async function updateAdaptiveTrainingSettings(
  userId: string,
  authenticatedUserId: string,
  settings: AdaptiveTrainingSettingsResponse,
  date?: string
): Promise<AdaptiveTrainingDashboardResponse> {
  const presetRows = await adaptiveTrainingRepository.getPresetRows(
    userId,
    authenticatedUserId
  );
  const ownedIds = new Set(buildPresets(presetRows).map((preset) => preset.id));
  const invalidId = settings.candidateWorkoutPresetIds.find(
    (presetId) => !ownedIds.has(presetId)
  );
  if (invalidId !== undefined) {
    throw new Error(
      `Workout preset ${invalidId} is not available to this user.`
    );
  }
  await adaptiveTrainingRepository.upsertSettings(userId, authenticatedUserId, {
    ...settings,
    preferredMuscles: [
      ...new Set(
        settings.preferredMuscles
          .map((muscle) => muscle.trim().toLowerCase())
          .filter(Boolean)
      ),
    ],
    candidateWorkoutPresetIds: [...new Set(settings.candidateWorkoutPresetIds)],
  });
  return getAdaptiveTrainingDashboard(userId, authenticatedUserId, date, {
    forceRegenerate: true,
  });
}

export async function updateAdaptiveTrainingRecommendationStatus(
  userId: string,
  authenticatedUserId: string,
  date: string,
  status: UpdateAdaptiveTrainingRecommendationStatusRequest['status']
): Promise<AdaptiveTrainingRecommendation> {
  const row = await adaptiveTrainingRepository.updateRecommendationStatus(
    userId,
    authenticatedUserId,
    date,
    status
  );
  if (!row) throw new Error('Adaptive training recommendation not found.');
  return recommendationFromRow(row);
}

export default {
  getAdaptiveTrainingDashboard,
  updateAdaptiveTrainingSettings,
  updateAdaptiveTrainingRecommendationStatus,
};
