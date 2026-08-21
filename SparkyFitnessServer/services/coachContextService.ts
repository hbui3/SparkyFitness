import {
  addDays,
  localDateToDay,
  todayInZone,
  type AdaptiveTrainingRecommendation,
  type CoachTodayStatusResponse,
} from '@workspace/shared';
import onboardingRepository from '../models/onboardingRepository.js';
import preferenceRepository from '../models/preferenceRepository.js';
import foodRepository from '../models/foodMisc.js';
import measurementRepository from '../models/measurementRepository.js';
import coachRepository from '../models/coachRepository.js';
import workoutDeduplicationService from './workoutDeduplicationService.js';
import goalService from './goalService.js';
import { getDailySummary } from './dailySummaryService.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';
import adaptiveTrainingService from './adaptiveTrainingService.js';
import plannedWorkoutScheduleService, {
  type PlannedWorkoutScheduleStatus,
} from './plannedWorkoutScheduleService.js';
import {
  canonicalSleepScore,
  canonicalSleepSeconds,
} from '../utils/canonicalSleep.js';

export interface CanonicalCoachGoals {
  primaryGoal: string | null;
  calorieTarget: number | null;
  proteinTargetG: number | null;
  waterTargetMl: number | null;
}

export interface CoachDailyProgress extends CanonicalCoachGoals {
  date: string;
  caloriesConsumed: number;
  caloriesBurned: number;
  netCalories: number;
  caloriesRemaining: number | null;
  proteinConsumedG: number;
  proteinRemainingG: number | null;
  waterConsumedMl: number;
  waterRemainingMl: number | null;
}

export interface CoachPeriodProgress {
  startDate: string;
  endDate: string;
  totalDays: number;
  nutritionLoggedDays: number;
  averageCaloriesOnLoggedDays: number | null;
  averageProteinOnLoggedDaysG: number | null;
  averageCalorieTarget: number | null;
  averageProteinTargetG: number | null;
  calorieTargetDays: number;
  waterLoggedDays: number;
  averageWaterOnLoggedDaysMl: number | null;
  averageWaterTargetMl: number | null;
  workoutCount: number;
}

export interface CoachWeightTrend {
  entries: number;
  firstWeightKg: number | null;
  latestWeightKg: number | null;
  changeKg: number | null;
}

export interface CoachMuscleLoad {
  muscle: string;
  lastTrainedOn: string | null;
  weightedLoad: number;
}

export interface CoachRecoveryContext {
  observedOn: string | null;
  sleepHours: number | null;
  sleepScore: number | null;
  restingHeartRate: number | null;
  hrvRmssdMs: number | null;
  vo2Max: number | null;
  recoveryTimeHours: number | null;
  trainingReadinessScore: number | null;
  acuteTrainingLoad: number | null;
  chronicTrainingLoad: number | null;
  acwrRatio: number | null;
  stressLevel: number | null;
  bodyBatteryHighest: number | null;
  bodyBatteryLowest: number | null;
  recentMuscleLoad: CoachMuscleLoad[];
}

export interface CoachContextSnapshot {
  timezone: string;
  today: CoachDailyProgress;
  week: CoachPeriodProgress;
  longTerm: CoachPeriodProgress;
  weight30Days: CoachWeightTrend;
  recovery: CoachRecoveryContext;
  adaptiveTraining: AdaptiveTrainingRecommendation;
  trainingSchedule?: PlannedWorkoutScheduleStatus;
}

interface GoalRecord {
  calories?: unknown;
  protein?: unknown;
  water_goal_ml?: unknown;
}

interface NutritionRow {
  entry_date: Date | string;
  total_calories: unknown;
  total_protein: unknown;
}

interface WaterRow {
  entry_date: Date | string;
  water_ml: unknown;
}

interface WeightRow {
  entry_date: Date | string;
  weight: unknown;
}

interface TrendContext {
  nutritionRows: NutritionRow[];
  waterRows: WaterRow[];
  goalsByDate: Record<string, GoalRecord>;
  weekExercise: { workout_count?: unknown };
  longExercise: { workout_count?: unknown };
  weightRows: WeightRow[];
  recoveryRows: Awaited<ReturnType<typeof coachRepository.getRecoverySignals>>;
}

const TREND_CACHE_TTL_MS = 5 * 60_000;
const trendCache = new Map<
  string,
  { expiresAt: number; value: Promise<TrendContext> }
>();

function latestHrvRmssd(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const sample = value[index];
    if (!sample || typeof sample !== 'object') continue;
    const parsed = finiteNumber((sample as Record<string, unknown>).rmssd_ms);
    if (parsed !== null) return Math.round(parsed);
  }
  return null;
}

function buildRecoveryContext(
  rows: TrendContext['recoveryRows'],
  adaptiveMuscleLoad: Array<{
    muscle: string;
    lastTrainedOn: string | null;
    loadScore: number;
  }>
): CoachRecoveryContext {
  const health = (rows.health ?? {}) as Record<string, unknown>;
  const sleep = (rows.sleep ?? {}) as Record<string, unknown>;
  const hrv = (rows.hrv ?? {}) as Record<string, unknown>;
  const sleepSeconds =
    rows.sleep === null ? null : canonicalSleepSeconds(rows.sleep);
  return {
    observedOn:
      health.entry_date || sleep.entry_date || hrv.entry_date
        ? dayString(
            (health.entry_date ?? sleep.entry_date ?? hrv.entry_date) as
              | Date
              | string
          )
        : null,
    sleepHours: rounded(sleepSeconds === null ? null : sleepSeconds / 3600),
    sleepScore: rounded(
      rows.sleep === null ? null : canonicalSleepScore(rows.sleep)
    ),
    restingHeartRate: rounded(finiteNumber(health.resting_heart_rate)),
    hrvRmssdMs: latestHrvRmssd(hrv.samples),
    vo2Max: finiteNumber(health.vo2_max),
    recoveryTimeHours: rounded(finiteNumber(health.recovery_time_hours)),
    trainingReadinessScore: rounded(
      finiteNumber(health.training_readiness_score)
    ),
    acuteTrainingLoad: rounded(finiteNumber(health.acute_training_load)),
    chronicTrainingLoad: rounded(finiteNumber(health.chronic_training_load)),
    acwrRatio: finiteNumber(health.acwr_ratio),
    stressLevel: rounded(finiteNumber(health.avg_stress_level)),
    bodyBatteryHighest: rounded(finiteNumber(health.body_battery_highest)),
    bodyBatteryLowest: rounded(finiteNumber(health.body_battery_lowest)),
    recentMuscleLoad: adaptiveMuscleLoad
      .map((item) => ({
        muscle: item.muscle,
        lastTrainedOn: item.lastTrainedOn,
        weightedLoad: item.loadScore,
      }))
      .sort((a, b) => b.weightedLoad - a.weightedLoad)
      .slice(0, 8),
  };
}

async function getTrendContext(
  userId: string,
  today: string,
  weekStart: string,
  longStart: string,
  longDates: string[]
): Promise<TrendContext> {
  const key = `${userId}:${today}`;
  const cached = trendCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = Promise.all([
    foodRepository.getDailyNutritionSummariesByDates(userId, longDates),
    measurementRepository.getWaterIntakesByDates(userId, longDates),
    goalService.getUserGoalsForRange(userId, longStart, today, true),
    workoutDeduplicationService.getCanonicalWorkoutAggregates(
      userId,
      weekStart,
      today
    ),
    workoutDeduplicationService.getCanonicalWorkoutAggregates(
      userId,
      longStart,
      today
    ),
    coachRepository.getWeightSeries(userId, 29, today),
    coachRepository.getRecoverySignals(userId, today),
  ]).then(
    ([
      nutritionRows,
      waterRows,
      goalsByDate,
      weekExercise,
      longExercise,
      weightRows,
      recoveryRows,
    ]) => ({
      nutritionRows: nutritionRows as NutritionRow[],
      waterRows: waterRows as WaterRow[],
      goalsByDate: goalsByDate as Record<string, GoalRecord>,
      weekExercise: weekExercise as { workout_count?: unknown },
      longExercise: longExercise as { workout_count?: unknown },
      weightRows: weightRows as WeightRow[],
      recoveryRows,
    })
  );
  trendCache.set(key, { expiresAt: Date.now() + TREND_CACHE_TTL_MS, value });
  if (trendCache.size > 500)
    trendCache.delete(trendCache.keys().next().value ?? '');
  return value;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rounded(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

function dayString(value: Date | string): string {
  return value instanceof Date ? localDateToDay(value) : String(value);
}

function buildDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (let cursor = startDate; cursor <= endDate; cursor = addDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

function primaryGoalFromSources(
  goalMode: unknown,
  onboardingGoal: string | null
): string | null {
  switch (goalMode) {
    case 'cut':
    case 'high_cut':
      return 'lose_weight';
    case 'lean_bulk':
    case 'bulk':
      return 'gain_weight';
    case 'maintain':
      return 'maintain_weight';
    case 'recomp':
      return 'body_recomposition';
    case 'manual':
      return onboardingGoal;
    default:
      return onboardingGoal;
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildPeriodProgress(
  dates: string[],
  nutritionByDate: Map<string, { calories: number; protein: number }>,
  waterByDate: Map<string, number>,
  goalsByDate: Record<string, GoalRecord>,
  workoutCount: number
): CoachPeriodProgress {
  const nutrition = dates
    .map((date) => nutritionByDate.get(date))
    .filter(
      (value): value is { calories: number; protein: number } =>
        value !== undefined
    );
  const water = dates
    .map((date) => waterByDate.get(date))
    .filter((value): value is number => value !== undefined);
  const calorieTargets = dates
    .map((date) => finiteNumber(goalsByDate[date]?.calories))
    .filter((value): value is number => value !== null && value > 0);
  const proteinTargets = dates
    .map((date) => finiteNumber(goalsByDate[date]?.protein))
    .filter((value): value is number => value !== null && value > 0);
  const waterTargets = dates
    .map((date) => finiteNumber(goalsByDate[date]?.water_goal_ml))
    .filter((value): value is number => value !== null && value > 0);
  const calorieTargetDays = dates.filter((date) => {
    const consumed = nutritionByDate.get(date)?.calories;
    const target = finiteNumber(goalsByDate[date]?.calories);
    return (
      consumed !== undefined &&
      target !== null &&
      target > 0 &&
      consumed >= target * 0.9 &&
      consumed <= target * 1.1
    );
  }).length;

  return {
    startDate: dates[0] ?? '',
    endDate: dates[dates.length - 1] ?? '',
    totalDays: dates.length,
    nutritionLoggedDays: nutrition.length,
    averageCaloriesOnLoggedDays: rounded(
      average(nutrition.map((entry) => entry.calories))
    ),
    averageProteinOnLoggedDaysG: rounded(
      average(nutrition.map((entry) => entry.protein))
    ),
    averageCalorieTarget: rounded(average(calorieTargets)),
    averageProteinTargetG: rounded(average(proteinTargets)),
    calorieTargetDays,
    waterLoggedDays: water.length,
    averageWaterOnLoggedDaysMl: rounded(average(water)),
    averageWaterTargetMl: rounded(average(waterTargets)),
    workoutCount,
  };
}

export async function getCanonicalCoachGoals(
  userId: string,
  timezone?: string
): Promise<CanonicalCoachGoals> {
  const tz = timezone ?? (await loadUserTimezone(userId));
  const today = todayInZone(tz);
  const [onboarding, preferences, goals] = await Promise.all([
    onboardingRepository.getOnboardingGoalData(userId),
    preferenceRepository.getUserPreferences(userId),
    goalService.getUserGoals(userId, today, undefined, true),
  ]);
  const goalRecord = goals as GoalRecord;
  return {
    primaryGoal: primaryGoalFromSources(
      (preferences as Record<string, unknown> | null)?.goal_mode,
      onboarding?.primary_goal ?? null
    ),
    calorieTarget: rounded(finiteNumber(goalRecord.calories)),
    proteinTargetG: rounded(finiteNumber(goalRecord.protein)),
    waterTargetMl: rounded(finiteNumber(goalRecord.water_goal_ml)),
  };
}

export async function getCoachContextSnapshot(
  userId: string,
  timezone?: string
): Promise<CoachContextSnapshot> {
  const tz = timezone ?? (await loadUserTimezone(userId));
  const today = todayInZone(tz);
  const weekStart = addDays(today, -6);
  const longStart = addDays(today, -29);
  const longDates = buildDateRange(longStart, today);
  const weekDates = longDates.slice(-7);

  const [
    canonicalGoals,
    dailySummary,
    trend,
    adaptiveTraining,
    trainingSchedule,
  ] = await Promise.all([
    getCanonicalCoachGoals(userId, tz),
    getDailySummary({
      actorUserId: userId,
      targetUserId: userId,
      date: today,
      includeCheckin: true,
    }),
    getTrendContext(userId, today, weekStart, longStart, longDates),
    adaptiveTrainingService.getAdaptiveTrainingDashboard(userId, userId, today),
    plannedWorkoutScheduleService.getPlannedWorkoutScheduleStatus(
      userId,
      today
    ),
  ]);

  const {
    nutritionRows,
    waterRows,
    goalsByDate,
    weekExercise,
    longExercise,
    weightRows,
    recoveryRows,
  } = trend;

  const nutritionByDate = new Map<
    string,
    { calories: number; protein: number }
  >(
    (nutritionRows as NutritionRow[]).map((row) => [
      dayString(row.entry_date),
      {
        calories: finiteNumber(row.total_calories) ?? 0,
        protein: finiteNumber(row.total_protein) ?? 0,
      },
    ])
  );
  const waterByDate = new Map<string, number>(
    (waterRows as WaterRow[]).map((row) => [
      dayString(row.entry_date),
      finiteNumber(row.water_ml) ?? 0,
    ])
  );
  const typedGoals = goalsByDate as Record<string, GoalRecord>;
  const typedWeights = weightRows as WeightRow[];
  const firstWeight = finiteNumber(typedWeights[0]?.weight);
  const latestWeight = finiteNumber(
    typedWeights[typedWeights.length - 1]?.weight
  );

  const foodProtein = (
    dailySummary.foodEntries as Array<{
      protein?: number | null;
      quantity?: number | null;
      serving_size?: number | null;
    }>
  ).reduce((sum, entry) => {
    const protein = finiteNumber(entry.protein) ?? 0;
    const quantity = finiteNumber(entry.quantity) ?? 0;
    const servingSize = finiteNumber(entry.serving_size) ?? 100;
    return sum + (servingSize > 0 ? (protein * quantity) / servingSize : 0);
  }, 0);
  const proteinConsumed =
    foodProtein + (finiteNumber(dailySummary.supplementTotals.protein) ?? 0);
  const caloriesConsumed = dailySummary.calorieBalance.eaten;
  const waterConsumed = Math.round(dailySummary.waterIntake);

  return {
    timezone: tz,
    today: {
      date: today,
      ...canonicalGoals,
      caloriesConsumed,
      caloriesBurned: dailySummary.calorieBalance.burned,
      netCalories: dailySummary.calorieBalance.net,
      caloriesRemaining:
        canonicalGoals.calorieTarget === null
          ? null
          : dailySummary.calorieBalance.remaining,
      proteinConsumedG: Math.round(proteinConsumed),
      proteinRemainingG:
        canonicalGoals.proteinTargetG === null
          ? null
          : Math.max(
              0,
              Math.round(canonicalGoals.proteinTargetG - proteinConsumed)
            ),
      waterConsumedMl: waterConsumed,
      waterRemainingMl:
        canonicalGoals.waterTargetMl === null
          ? null
          : Math.max(
              0,
              Math.round(canonicalGoals.waterTargetMl - waterConsumed)
            ),
    },
    week: buildPeriodProgress(
      weekDates,
      nutritionByDate,
      waterByDate,
      typedGoals,
      Number(weekExercise.workout_count) || 0
    ),
    longTerm: buildPeriodProgress(
      longDates,
      nutritionByDate,
      waterByDate,
      typedGoals,
      Number(longExercise.workout_count) || 0
    ),
    weight30Days: {
      entries: typedWeights.length,
      firstWeightKg: firstWeight,
      latestWeightKg: latestWeight,
      changeKg:
        typedWeights.length < 2 || firstWeight === null || latestWeight === null
          ? null
          : Math.round((latestWeight - firstWeight) * 100) / 100,
    },
    recovery: buildRecoveryContext(recoveryRows, adaptiveTraining.muscleLoad),
    adaptiveTraining: adaptiveTraining.recommendation,
    trainingSchedule,
  };
}

function valueOrUnknown(value: number | null, suffix: string): string {
  return value === null ? 'not set' : `${value}${suffix}`;
}

export function formatCoachContext(snapshot: CoachContextSnapshot): string[] {
  const { today, week, longTerm, weight30Days, recovery, adaptiveTraining } =
    snapshot;
  const lines = [
    `Canonical primary goal: ${today.primaryGoal ?? 'not set'}`,
    `Canonical targets for ${today.date}: ${valueOrUnknown(today.calorieTarget, ' kcal')}, ${valueOrUnknown(today.proteinTargetG, ' g protein')}, ${valueOrUnknown(today.waterTargetMl, ' ml water')}`,
    `Today so far: ${today.caloriesConsumed} kcal food/supplement intake; ${today.caloriesBurned} kcal burned according to the configured energy rules; ${today.netCalories} kcal net; ${valueOrUnknown(today.caloriesRemaining, ' kcal remaining')}; ${today.proteinConsumedG} g protein (${valueOrUnknown(today.proteinRemainingG, ' g remaining')}); ${today.waterConsumedMl} ml water (${valueOrUnknown(today.waterRemainingMl, ' ml remaining')})`,
    'The live totals above already include every successfully stored entry mentioned earlier in the conversation. Never add calories, water, protein, or other values from chat history to them, and never count burned calories as intake.',
    `Last 7 days (${week.startDate} to ${week.endDate}): nutrition logged ${week.nutritionLoggedDays}/${week.totalDays} days; logged-day averages ${valueOrUnknown(week.averageCaloriesOnLoggedDays, ' kcal')} and ${valueOrUnknown(week.averageProteinOnLoggedDaysG, ' g protein')}; calorie target met within +/-10% on ${week.calorieTargetDays} logged days; water logged ${week.waterLoggedDays}/${week.totalDays} days with ${valueOrUnknown(week.averageWaterOnLoggedDaysMl, ' ml average')}; workouts ${week.workoutCount}`,
    `Last 30 days (${longTerm.startDate} to ${longTerm.endDate}): nutrition logged ${longTerm.nutritionLoggedDays}/${longTerm.totalDays} days; logged-day averages ${valueOrUnknown(longTerm.averageCaloriesOnLoggedDays, ' kcal')} and ${valueOrUnknown(longTerm.averageProteinOnLoggedDaysG, ' g protein')}; workouts ${longTerm.workoutCount}`,
  ];
  if (weight30Days.changeKg !== null) {
    lines.push(
      `30-day weight development: ${weight30Days.firstWeightKg} kg to ${weight30Days.latestWeightKg} kg (${weight30Days.changeKg >= 0 ? '+' : ''}${weight30Days.changeKg} kg across ${weight30Days.entries} measurements)`
    );
  } else {
    lines.push(
      `30-day weight development: insufficient data (${weight30Days.entries} measurements)`
    );
  }
  const recoveryValues = [
    recovery.sleepHours === null ? null : `${recovery.sleepHours} h sleep`,
    recovery.sleepScore === null ? null : `sleep score ${recovery.sleepScore}`,
    recovery.hrvRmssdMs === null ? null : `HRV ${recovery.hrvRmssdMs} ms RMSSD`,
    recovery.restingHeartRate === null
      ? null
      : `resting HR ${recovery.restingHeartRate} bpm`,
    recovery.vo2Max === null ? null : `VO2max ${recovery.vo2Max}`,
    recovery.trainingReadinessScore === null
      ? null
      : `training readiness ${recovery.trainingReadinessScore}`,
    recovery.recoveryTimeHours === null
      ? null
      : `recovery time ${recovery.recoveryTimeHours} h`,
  ].filter((value): value is string => value !== null);
  if (recoveryValues.length > 0) {
    lines.push(`Latest recovery signals: ${recoveryValues.join('; ')}`);
  }
  if (recovery.recentMuscleLoad.length > 0) {
    lines.push(
      `Recent muscle load (relative, last 4 calendar days): ${recovery.recentMuscleLoad
        .map(
          (item) =>
            `${item.muscle}=${item.weightedLoad} (${item.lastTrainedOn})`
        )
        .join(', ')}`
    );
  }
  lines.push(
    adaptiveTraining.kind === 'workout'
      ? `Adaptive training recommendation for ${adaptiveTraining.date}: ${adaptiveTraining.presetName ?? 'workout'} (fit score ${adaptiveTraining.score}/100, volume factor ${adaptiveTraining.volumeFactor}). Treat this as the canonical training recommendation in web and Telegram.`
      : `Adaptive training recommendation for ${adaptiveTraining.date}: recovery day (readiness/fit score ${adaptiveTraining.score}/100). Treat this as the canonical training recommendation in web and Telegram.`
  );
  if ((snapshot.trainingSchedule?.dueToday.length ?? 0) > 0) {
    lines.push(
      `Scheduled workouts still due today: ${snapshot.trainingSchedule?.dueToday.map((item) => item.name).join(', ')}. Treat these as concrete plan commitments, not generic recommendations.`
    );
  }
  if ((snapshot.trainingSchedule?.missedYesterday.length ?? 0) > 0) {
    lines.push(
      `Missed scheduled workouts from yesterday: ${snapshot.trainingSchedule?.missedYesterday.map((item) => item.name).join(', ')}. They are carried forward by the proactive scheduler and should be acknowledged explicitly.`
    );
  }
  return lines;
}

function nextTodayAction(
  snapshot: CoachContextSnapshot,
  language: string
): string {
  const { today, recovery } = snapshot;
  const de = language.toLowerCase().startsWith('de');
  const dueWorkout = snapshot.trainingSchedule?.dueToday[0];
  if (dueWorkout) {
    return de
      ? `Das geplante Training „${dueWorkout.name}“ steht heute noch an.`
      : `The scheduled workout “${dueWorkout.name}” is still due today.`;
  }
  if ((recovery.trainingReadinessScore ?? 100) < 40) {
    return de
      ? 'Heute Erholung priorisieren und Training bewusst leicht halten.'
      : 'Prioritize recovery and keep training deliberately easy today.';
  }
  if ((today.waterRemainingMl ?? 0) > 750) {
    return de
      ? `Als Nächstes etwa ${Math.min(500, today.waterRemainingMl ?? 0)} ml Wasser trinken.`
      : `Drink about ${Math.min(500, today.waterRemainingMl ?? 0)} ml water next.`;
  }
  if ((today.proteinRemainingG ?? 0) > 25) {
    return de
      ? `Die nächste Mahlzeit auf ungefähr ${Math.min(40, today.proteinRemainingG ?? 0)} g Protein ausrichten.`
      : `Aim for about ${Math.min(40, today.proteinRemainingG ?? 0)} g protein in the next meal.`;
  }
  if ((today.caloriesRemaining ?? 0) < 0) {
    return de
      ? 'Das Kalorienziel ist erreicht; die nächste Entscheidung an Hunger und Erholung ausrichten.'
      : 'The calorie target is reached; base the next choice on hunger and recovery.';
  }
  return de
    ? 'Die aktuellen Ziele sind gut abgedeckt; normal weiterloggen und den Verlauf beobachten.'
    : 'Current targets are well covered; keep logging normally and watch the trend.';
}

export function coachTodayStatusFromSnapshot(
  snapshot: CoachContextSnapshot,
  language = 'de'
): CoachTodayStatusResponse {
  const { today } = snapshot;
  return {
    date: today.date,
    timezone: snapshot.timezone,
    caloriesConsumed: today.caloriesConsumed,
    caloriesBurned: today.caloriesBurned,
    netCalories: today.netCalories,
    calorieTarget: today.calorieTarget,
    caloriesRemaining: today.caloriesRemaining,
    proteinConsumedG: today.proteinConsumedG,
    proteinTargetG: today.proteinTargetG,
    proteinRemainingG: today.proteinRemainingG,
    waterConsumedMl: today.waterConsumedMl,
    waterTargetMl: today.waterTargetMl,
    waterRemainingMl: today.waterRemainingMl,
    nextAction: nextTodayAction(snapshot, language),
  };
}

export function renderCoachTodayStatus(
  status: CoachTodayStatusResponse,
  language = 'de'
): string {
  const de = language.toLowerCase().startsWith('de');
  const calorieTarget = status.calorieTarget ?? '–';
  const proteinTarget = status.proteinTargetG ?? '–';
  const waterTarget = status.waterTargetMl ?? '–';
  if (!de) {
    return [
      `Today (${status.date})`,
      `Calories: ${status.caloriesConsumed} eaten − ${status.caloriesBurned} burned = ${status.netCalories} net; target ${calorieTarget}, ${status.caloriesRemaining ?? '–'} remaining.`,
      `Protein: ${status.proteinConsumedG} / ${proteinTarget} g; ${status.proteinRemainingG ?? '–'} g remaining.`,
      `Water: ${status.waterConsumedMl} / ${waterTarget} ml; ${status.waterRemainingMl ?? '–'} ml remaining.`,
      `Next useful step: ${status.nextAction}`,
    ].join('\n');
  }
  return [
    `Heute (${status.date})`,
    `Kalorien: ${status.caloriesConsumed} gegessen − ${status.caloriesBurned} verbrannt = ${status.netCalories} netto; Ziel ${calorieTarget}, ${status.caloriesRemaining ?? '–'} verbleibend.`,
    `Protein: ${status.proteinConsumedG} / ${proteinTarget} g; ${status.proteinRemainingG ?? '–'} g verbleibend.`,
    `Wasser: ${status.waterConsumedMl} / ${waterTarget} ml; ${status.waterRemainingMl ?? '–'} ml verbleibend.`,
    `Nächster sinnvoller Schritt: ${status.nextAction}`,
  ].join('\n');
}

export async function getCoachTodayStatus(
  userId: string,
  language = 'de'
): Promise<CoachTodayStatusResponse> {
  return coachTodayStatusFromSnapshot(
    await getCoachContextSnapshot(userId),
    language
  );
}

export default {
  getCanonicalCoachGoals,
  getCoachContextSnapshot,
  formatCoachContext,
  coachTodayStatusFromSnapshot,
  renderCoachTodayStatus,
  getCoachTodayStatus,
};
