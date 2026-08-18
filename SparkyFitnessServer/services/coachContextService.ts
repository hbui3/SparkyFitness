import { addDays, localDateToDay, todayInZone } from '@workspace/shared';
import onboardingRepository from '../models/onboardingRepository.js';
import preferenceRepository from '../models/preferenceRepository.js';
import foodRepository from '../models/foodMisc.js';
import measurementRepository from '../models/measurementRepository.js';
import coachRepository from '../models/coachRepository.js';
import goalService from './goalService.js';
import { getDailySummary } from './dailySummaryService.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';

export interface CanonicalCoachGoals {
  primaryGoal: string | null;
  calorieTarget: number | null;
  proteinTargetG: number | null;
  waterTargetMl: number | null;
}

export interface CoachDailyProgress extends CanonicalCoachGoals {
  date: string;
  caloriesConsumed: number;
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

export interface CoachContextSnapshot {
  timezone: string;
  today: CoachDailyProgress;
  week: CoachPeriodProgress;
  longTerm: CoachPeriodProgress;
  weight30Days: CoachWeightTrend;
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
    nutritionRows,
    waterRows,
    goalsByDate,
    weekExercise,
    longExercise,
    weightRows,
  ] = await Promise.all([
    getCanonicalCoachGoals(userId, tz),
    getDailySummary({
      actorUserId: userId,
      targetUserId: userId,
      date: today,
      includeCheckin: true,
    }),
    foodRepository.getDailyNutritionSummariesByDates(userId, longDates),
    measurementRepository.getWaterIntakesByDates(userId, longDates),
    goalService.getUserGoalsForRange(userId, longStart, today, true),
    coachRepository.getExerciseAggregates(userId, weekStart, today),
    coachRepository.getExerciseAggregates(userId, longStart, today),
    coachRepository.getWeightSeries(userId, 29, today),
  ]);

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
      caloriesRemaining:
        canonicalGoals.calorieTarget === null
          ? null
          : dailySummary.calorieBalance.remaining,
      proteinConsumedG: Math.round(proteinConsumed),
      proteinRemainingG:
        canonicalGoals.proteinTargetG === null
          ? null
          : Math.round(canonicalGoals.proteinTargetG - proteinConsumed),
      waterConsumedMl: waterConsumed,
      waterRemainingMl:
        canonicalGoals.waterTargetMl === null
          ? null
          : Math.round(canonicalGoals.waterTargetMl - waterConsumed),
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
  };
}

function valueOrUnknown(value: number | null, suffix: string): string {
  return value === null ? 'not set' : `${value}${suffix}`;
}

export function formatCoachContext(snapshot: CoachContextSnapshot): string[] {
  const { today, week, longTerm, weight30Days } = snapshot;
  const lines = [
    `Canonical primary goal: ${today.primaryGoal ?? 'not set'}`,
    `Canonical targets for ${today.date}: ${valueOrUnknown(today.calorieTarget, ' kcal')}, ${valueOrUnknown(today.proteinTargetG, ' g protein')}, ${valueOrUnknown(today.waterTargetMl, ' ml water')}`,
    `Today so far: ${today.caloriesConsumed} kcal consumed (${valueOrUnknown(today.caloriesRemaining, ' kcal remaining')}), ${today.proteinConsumedG} g protein (${valueOrUnknown(today.proteinRemainingG, ' g remaining')}), ${today.waterConsumedMl} ml water (${valueOrUnknown(today.waterRemainingMl, ' ml remaining')})`,
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
  return lines;
}

export default {
  getCanonicalCoachGoals,
  getCoachContextSnapshot,
  formatCoachContext,
};
