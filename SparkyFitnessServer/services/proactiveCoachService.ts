import { dayOfWeek, instantHourMinute, instantToDay } from '@workspace/shared';
import { createHash } from 'node:crypto';
import coachProfileRepository, {
  type ProactiveCoachCandidate,
  type ScheduledProactiveCoachMessageKind,
} from '../models/coachProfileRepository.js';
import coachContextService, {
  type CoachContextSnapshot,
} from './coachContextService.js';
import coachEventService from './coachEventService.js';
import plannedWorkoutScheduleService from './plannedWorkoutScheduleService.js';
import { log } from '../config/logging.js';
import { evaluateProactiveCoachOpportunity } from './proactiveCoachDecisionService.js';
import { composeAdaptiveCoachMessage } from './proactiveCoachMessageService.js';
import {
  getRestockReminder,
  type CoachRestockReminder,
} from './coachMealPlanningService.js';
import {
  COACH_MEAL_INGREDIENT_QUESTIONS,
  getCoachMealSuggestion,
  MIN_COACH_MEAL_CALORIES,
  renderCoachMealSuggestion,
  type CoachMealSuggestion,
  type CoachMealTargets,
} from './coachMealSuggestionService.js';

export const ADAPTIVE_COACH_START_MINUTES = 7 * 60;
export const ADAPTIVE_COACH_END_MINUTES = 20 * 60;
export const ADAPTIVE_COACH_INTERVAL_MINUTES = 2 * 60;
export const ADAPTIVE_COACH_MIN_CHECK_GAP_MINUTES = 3;
export const ADAPTIVE_COACH_MAX_CHECK_GAP_MINUTES = 8;
export const EVENING_RESTOCK_START_MINUTES = 17 * 60;

function timeToMinutes(value: string): number {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}

function isAtOrAfterScheduledTime(
  scheduledTime: string,
  now: Date,
  timezone: string
): boolean {
  const local = instantHourMinute(now, timezone);
  return local.hour * 60 + local.minute >= timeToMinutes(scheduledTime);
}

function minuteLabel(totalMinutes: number): string {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function getAdaptiveDeliverySlot(
  candidate: ProactiveCoachCandidate,
  now: Date
): string | null {
  if (!candidate.adaptiveCheckInsEnabled) return null;
  const local = instantHourMinute(now, candidate.timezone);
  const localMinutes = local.hour * 60 + local.minute;
  const startMinutes = timeToMinutes(candidate.adaptiveStartTime);
  const endMinutes = timeToMinutes(candidate.adaptiveEndTime);
  if (localMinutes < startMinutes || localMinutes > endMinutes) {
    return null;
  }
  const localDate = instantToDay(now, candidate.timezone);
  let slotMinutes = startMinutes;
  let latestDueSlot: number | null = null;
  let index = 0;
  while (slotMinutes <= endMinutes) {
    const digest = createHash('sha256')
      .update(`${candidate.userId}:${localDate}:${index}`)
      .digest();
    const gap =
      ADAPTIVE_COACH_MIN_CHECK_GAP_MINUTES +
      (digest.readUInt32BE(0) %
        (ADAPTIVE_COACH_MAX_CHECK_GAP_MINUTES -
          ADAPTIVE_COACH_MIN_CHECK_GAP_MINUTES +
          1));
    slotMinutes += gap;
    if (slotMinutes > localMinutes || slotMinutes > endMinutes) break;
    latestDueSlot = slotMinutes;
    index += 1;
  }
  return latestDueSlot === null
    ? null
    : `${localDate}T${minuteLabel(latestDueSlot)}`;
}

export function getDueMessageKinds(
  candidate: ProactiveCoachCandidate,
  now: Date
): ScheduledProactiveCoachMessageKind[] {
  const kinds: ScheduledProactiveCoachMessageKind[] = [];
  const localDate = instantToDay(now, candidate.timezone);
  const adaptiveSlot = getAdaptiveDeliverySlot(candidate, now);
  if (adaptiveSlot && candidate.adaptiveLastObservedSlot !== adaptiveSlot) {
    kinds.push('adaptive');
  }
  if (
    candidate.dailyCheckInEnabled &&
    candidate.dailyLastSentOn !== localDate &&
    isAtOrAfterScheduledTime(
      candidate.dailyCheckInTime,
      now,
      candidate.timezone
    )
  ) {
    kinds.push('daily');
  }
  if (
    candidate.weeklyReviewEnabled &&
    candidate.weeklyLastSentOn !== localDate &&
    dayOfWeek(localDate) === candidate.weeklyReviewDay &&
    isAtOrAfterScheduledTime(
      candidate.weeklyReviewTime,
      now,
      candidate.timezone
    )
  ) {
    kinds.push('weekly');
  }
  return kinds;
}

export function isEveningRestockCheckDue(
  candidate: ProactiveCoachCandidate,
  now: Date
): boolean {
  if (
    !candidate.proactiveCategories.includes('nutrition') ||
    (!candidate.adaptiveCheckInsEnabled && !candidate.dailyCheckInEnabled)
  ) {
    return false;
  }
  const localDate = instantToDay(now, candidate.timezone);
  if (candidate.restockLastSentOn === localDate) return false;
  const local = instantHourMinute(now, candidate.timezone);
  return local.hour * 60 + local.minute >= EVENING_RESTOCK_START_MINUTES;
}

function targetValue(value: number | null, suffix: string): string {
  return value === null ? `– ${suffix}` : `${value} ${suffix}`;
}

function adaptiveMetricsDe(snapshot: CoachContextSnapshot): string {
  const { today } = snapshot;
  return `Aktuell: ${today.caloriesConsumed} kcal gegessen − ${today.caloriesBurned} kcal verbrannt = ${today.netCalories} kcal netto; Ziel ${targetValue(today.calorieTarget, 'kcal')}, noch ${today.caloriesRemaining ?? '–'} kcal. Protein ${today.proteinConsumedG} / ${targetValue(today.proteinTargetG, 'g')}; Wasser ${today.waterConsumedMl} / ${targetValue(today.waterTargetMl, 'ml')}.`;
}

function adaptiveMetricsEn(snapshot: CoachContextSnapshot): string {
  const { today } = snapshot;
  return `Right now: ${today.caloriesConsumed} kcal eaten − ${today.caloriesBurned} kcal burned = ${today.netCalories} kcal net; target ${targetValue(today.calorieTarget, 'kcal')}, ${today.caloriesRemaining ?? '–'} kcal remaining. Protein ${today.proteinConsumedG} / ${targetValue(today.proteinTargetG, 'g')}; water ${today.waterConsumedMl} / ${targetValue(today.waterTargetMl, 'ml')}.`;
}

export function adaptiveStateSignature(
  snapshot: CoachContextSnapshot,
  categories: readonly string[],
  deliverySlot?: string
): string {
  const slotMinutes = deliverySlot ? slotMinutesFromKey(deliverySlot) : 12 * 60;
  const state = {
    date: snapshot.today.date,
    phase:
      slotMinutes < 10 * 60
        ? 'morning'
        : slotMinutes < 13 * 60
          ? 'midday'
          : slotMinutes < 17 * 60
            ? 'afternoon'
            : 'evening',
    categories: [...categories].sort(),
    nutrition: categories.includes('nutrition')
      ? {
          caloriesConsumed: snapshot.today.caloriesConsumed,
          caloriesBurned: snapshot.today.caloriesBurned,
          proteinConsumedG: snapshot.today.proteinConsumedG,
        }
      : null,
    hydration: categories.includes('hydration')
      ? snapshot.today.waterConsumedMl
      : null,
    training: categories.includes('training')
      ? {
          workoutCount: snapshot.week.workoutCount,
          recommendation: snapshot.adaptiveTraining,
          dueToday:
            snapshot.trainingSchedule?.dueToday.map((item) => item.name) ?? [],
          missedYesterday:
            snapshot.trainingSchedule?.missedYesterday.map(
              (item) => item.name
            ) ?? [],
        }
      : null,
    recovery: categories.includes('recovery')
      ? {
          sleepScore: snapshot.recovery.sleepScore,
          readiness: snapshot.recovery.trainingReadinessScore,
          recoveryHours: snapshot.recovery.recoveryTimeHours,
          muscleLoad: snapshot.recovery.recentMuscleLoad,
        }
      : null,
  };
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

function adaptiveFocusDe(
  snapshot: CoachContextSnapshot,
  slotMinutes: number,
  categories: readonly string[]
): string {
  const { today } = snapshot;
  const slot = minuteLabel(slotMinutes);
  const dueWorkout = snapshot.trainingSchedule?.dueToday[0];
  const missedWorkout = snapshot.trainingSchedule?.missedYesterday.find(
    (item) => item.workoutPresetId === dueWorkout?.workoutPresetId
  );
  if (categories.includes('training') && dueWorkout) {
    if (missedWorkout && slotMinutes < 11 * 60) {
      return `Du hast „${missedWorkout.name}“ gestern nicht absolviert. Ich habe es deshalb auf heute vorgezogen; es steht heute mit hoher Priorität an.`;
    }
    return slotMinutes < 16 * 60
      ? `Das konkret geplante Training „${dueWorkout.name}“ steht heute noch an. Plane jetzt ein realistisches Zeitfenster dafür ein.`
      : `„${dueWorkout.name}“ ist heute weiterhin offen. Wenn du trainieren kannst, starte es jetzt; wenn ein echter Hinderungsgrund besteht, sag mir kurz Bescheid, damit ich den Plan gezielt anpasse.`;
  }
  if (
    categories.includes('recovery') &&
    ((snapshot.recovery.trainingReadinessScore ?? 100) < 40 ||
      (snapshot.recovery.sleepScore ?? 100) < 50)
  ) {
    return 'Deine Erholungswerte sind heute niedrig. Priorisiere Schlaf, lockere Bewegung und reduziere die Trainingsintensität.';
  }
  if (categories.includes('training') && slotMinutes < 13 * 60) {
    return snapshot.adaptiveTraining.kind === 'workout'
      ? `Dein heutiger Trainingsvorschlag ist „${snapshot.adaptiveTraining.presetName ?? 'Training'}“ mit einem Fit-Score von ${snapshot.adaptiveTraining.score}/100${snapshot.adaptiveTraining.volumeFactor < 1 ? ` und ${Math.round(snapshot.adaptiveTraining.volumeFactor * 100)} % Volumen` : ''}.`
      : `Heute ist ein Erholungstag empfohlen (Score ${snapshot.adaptiveTraining.score}/100). Plane höchstens lockere Bewegung ein.`;
  }
  if (
    categories.includes('nutrition') &&
    today.caloriesRemaining !== null &&
    today.caloriesRemaining < MIN_COACH_MEAL_CALORIES
  ) {
    return today.caloriesRemaining < 0
      ? `Du liegst ${Math.abs(today.caloriesRemaining)} kcal über deinem heutigen Ziel. Kein extremes Gegensteuern und keine zusätzliche große Mahlzeit nur wegen eines Proteinrests; plane die Proteinquelle morgen früher ein.`
      : `Es bleiben nur noch ${today.caloriesRemaining} kcal. Ich empfehle jetzt keine volle Mahlzeit; plane die Proteinquelle morgen früher ein.`;
  }
  if (categories.includes('nutrition') && today.caloriesConsumed === 0) {
    if (slotMinutes >= 10 * 60) {
      return `Bis ${slot} ist noch keine Mahlzeit erfasst. Falls du schon gegessen hast, trage sie jetzt nach; sonst plane die erste Mahlzeit passend zu deinem Ziel von ${targetValue(today.calorieTarget, 'kcal')}.`;
    }
    return `Plane deinen Tag jetzt grob: Ziel sind ${targetValue(today.calorieTarget, 'kcal')}, ${targetValue(today.proteinTargetG, 'g Protein')} und ${targetValue(today.waterTargetMl, 'ml Wasser')}.`;
  }
  if (
    categories.includes('hydration') &&
    today.waterConsumedMl === 0 &&
    slotMinutes >= 9 * 60
  ) {
    return `Bis ${slot} ist noch kein Wasser erfasst. Starte jetzt und behalte die verbleibenden ${today.waterRemainingMl ?? '–'} ml im Blick.`;
  }
  if (categories.includes('nutrition') && (today.caloriesRemaining ?? 0) < 0) {
    return `Du liegst ${Math.abs(today.caloriesRemaining ?? 0)} kcal über deinem heutigen Ziel. Kein Ausgleich durch extremes Sparen – halte die nächste Mahlzeit einfach und proteinreich.`;
  }
  if (
    categories.includes('nutrition') &&
    slotMinutes >= 12 * 60 &&
    (today.proteinRemainingG ?? 0) > 20
  ) {
    return `Es fehlen noch ${today.proteinRemainingG} g Protein. Plane die nächste Mahlzeit gezielt darum, statt den Rest am Abend nachholen zu müssen.`;
  }
  if (categories.includes('hydration') && (today.waterRemainingMl ?? 0) > 500) {
    return `Beim Wasser fehlen noch ${today.waterRemainingMl} ml. Teile das auf die verbleibenden Stunden auf.`;
  }
  if (slotMinutes >= 16 * 60 && (today.caloriesRemaining ?? 0) > 400) {
    return `Es bleiben noch ${today.caloriesRemaining} kcal. Entscheide jetzt, wie Abendessen und Snack zusammen in dieses Budget passen.`;
  }
  return `Du bist bei den erfassten Hauptzielen gut unterwegs. Halte den Kurs; noch offen sind ${today.caloriesRemaining ?? '–'} kcal, ${today.proteinRemainingG ?? '–'} g Protein und ${today.waterRemainingMl ?? '–'} ml Wasser.`;
}

function adaptiveFocusEn(
  snapshot: CoachContextSnapshot,
  slotMinutes: number,
  categories: readonly string[]
): string {
  const { today } = snapshot;
  const slot = minuteLabel(slotMinutes);
  const dueWorkout = snapshot.trainingSchedule?.dueToday[0];
  const missedWorkout = snapshot.trainingSchedule?.missedYesterday.find(
    (item) => item.workoutPresetId === dueWorkout?.workoutPresetId
  );
  if (categories.includes('training') && dueWorkout) {
    if (missedWorkout && slotMinutes < 11 * 60) {
      return `You did not complete “${missedWorkout.name}” yesterday, so I carried it forward. It is a high-priority workout today.`;
    }
    return slotMinutes < 16 * 60
      ? `The scheduled workout “${dueWorkout.name}” is still due today. Choose a realistic time window for it now.`
      : `“${dueWorkout.name}” is still open today. Start it now if you can; if there is a real constraint, tell me so I can adjust the plan deliberately.`;
  }
  if (
    categories.includes('recovery') &&
    ((snapshot.recovery.trainingReadinessScore ?? 100) < 40 ||
      (snapshot.recovery.sleepScore ?? 100) < 50)
  ) {
    return 'Your recovery signals are low today. Prioritize sleep and easy movement, and reduce training intensity.';
  }
  if (categories.includes('training') && slotMinutes < 13 * 60) {
    return snapshot.adaptiveTraining.kind === 'workout'
      ? `Today's workout recommendation is “${snapshot.adaptiveTraining.presetName ?? 'Workout'}” with a ${snapshot.adaptiveTraining.score}/100 fit score${snapshot.adaptiveTraining.volumeFactor < 1 ? ` and ${Math.round(snapshot.adaptiveTraining.volumeFactor * 100)}% volume` : ''}.`
      : `Today is a recommended recovery day (score ${snapshot.adaptiveTraining.score}/100). Keep movement easy.`;
  }
  if (
    categories.includes('nutrition') &&
    today.caloriesRemaining !== null &&
    today.caloriesRemaining < MIN_COACH_MEAL_CALORIES
  ) {
    return today.caloriesRemaining < 0
      ? `You are ${Math.abs(today.caloriesRemaining)} kcal above today's target. Do not compensate aggressively or add a large meal just for a protein gap; plan protein earlier tomorrow.`
      : `Only ${today.caloriesRemaining} kcal remain. I am not recommending a full meal now; plan the protein source earlier tomorrow.`;
  }
  if (categories.includes('nutrition') && today.caloriesConsumed === 0) {
    if (slotMinutes >= 10 * 60) {
      return `No meal is logged by ${slot}. If you already ate, log it now; otherwise plan the first meal around your ${targetValue(today.calorieTarget, 'kcal')} target.`;
    }
    return `Sketch out today now: targets are ${targetValue(today.calorieTarget, 'kcal')}, ${targetValue(today.proteinTargetG, 'g protein')}, and ${targetValue(today.waterTargetMl, 'ml water')}.`;
  }
  if (
    categories.includes('hydration') &&
    today.waterConsumedMl === 0 &&
    slotMinutes >= 9 * 60
  ) {
    return `No water is logged by ${slot}. Start now and keep the remaining ${today.waterRemainingMl ?? '–'} ml in view.`;
  }
  if (categories.includes('nutrition') && (today.caloriesRemaining ?? 0) < 0) {
    return `You are ${Math.abs(today.caloriesRemaining ?? 0)} kcal above today's target. Do not compensate aggressively; keep the next meal simple and protein-rich.`;
  }
  if (
    categories.includes('nutrition') &&
    slotMinutes >= 12 * 60 &&
    (today.proteinRemainingG ?? 0) > 20
  ) {
    return `${today.proteinRemainingG} g protein remain. Build the next meal around that instead of leaving it all for the evening.`;
  }
  if (categories.includes('hydration') && (today.waterRemainingMl ?? 0) > 500) {
    return `${today.waterRemainingMl} ml water remain. Spread that across the hours left today.`;
  }
  if (slotMinutes >= 16 * 60 && (today.caloriesRemaining ?? 0) > 400) {
    return `${today.caloriesRemaining} kcal remain. Decide now how dinner and a possible snack fit that budget together.`;
  }
  return `Your logged main targets are on track. Keep going; ${today.caloriesRemaining ?? '–'} kcal, ${today.proteinRemainingG ?? '–'} g protein, and ${today.waterRemainingMl ?? '–'} ml water remain.`;
}

function slotMinutesFromKey(slot: string): number {
  return timeToMinutes(slot.slice(-5));
}

export function renderAdaptiveCoachMessage(
  snapshot: CoachContextSnapshot,
  language: string,
  slot: string,
  categories: readonly string[] = [
    'nutrition',
    'hydration',
    'training',
    'recovery',
  ]
): string {
  const slotMinutes = slotMinutesFromKey(slot);
  if (language.toLowerCase().startsWith('de')) {
    return [
      `### Coach-Check um ${minuteLabel(slotMinutes)}`,
      '',
      adaptiveMetricsDe(snapshot),
      '',
      `**Jetzt sinnvoll:** ${adaptiveFocusDe(snapshot, slotMinutes, categories)}`,
    ].join('\n');
  }
  return [
    `### Coach check at ${minuteLabel(slotMinutes)}`,
    '',
    adaptiveMetricsEn(snapshot),
    '',
    `**Useful now:** ${adaptiveFocusEn(snapshot, slotMinutes, categories)}`,
  ].join('\n');
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function dailyFocusDe(snapshot: CoachContextSnapshot): string {
  const { today } = snapshot;
  const dueWorkout = snapshot.trainingSchedule?.dueToday[0];
  if (dueWorkout) {
    return `Das geplante Training „${dueWorkout.name}“ steht heute noch an.`;
  }
  if (
    today.caloriesRemaining !== null &&
    today.caloriesRemaining < MIN_COACH_MEAL_CALORIES
  ) {
    return today.caloriesRemaining < 0
      ? 'Dein Kalorienziel ist heute bereits überschritten. Iss nicht allein wegen des Proteinrests noch eine große Mahlzeit; plane die Proteinquelle morgen früher ein.'
      : `Es bleiben nur noch ungefähr ${today.caloriesRemaining} kcal. Ich empfehle keine volle Mahlzeit mehr; plane die Proteinquelle morgen früher ein.`;
  }
  if (today.caloriesConsumed === 0) {
    return 'Trage deine erste Mahlzeit ein, damit ich den restlichen Tag sinnvoll einordnen kann.';
  }
  if ((today.proteinRemainingG ?? 0) > 20) {
    return `Plane noch eine proteinreiche Mahlzeit ein; aktuell fehlen ungefähr ${today.proteinRemainingG} g Protein.`;
  }
  if ((today.caloriesRemaining ?? 0) > 400) {
    return `Für dein Tagesziel fehlen noch ungefähr ${today.caloriesRemaining} kcal. Plane sie bewusst ein, statt sie spät improvisieren zu müssen.`;
  }
  if ((today.waterRemainingMl ?? 0) > 500) {
    return `Beim Wasser fehlen noch ungefähr ${today.waterRemainingMl} ml.`;
  }
  return 'Deine heutigen Hauptziele liegen gut im Plan. Halte den restlichen Abend einfach und konsistent.';
}

function dailyFocusEn(snapshot: CoachContextSnapshot): string {
  const { today } = snapshot;
  const dueWorkout = snapshot.trainingSchedule?.dueToday[0];
  if (dueWorkout) {
    return `The scheduled workout “${dueWorkout.name}” is still due today.`;
  }
  if (
    today.caloriesRemaining !== null &&
    today.caloriesRemaining < MIN_COACH_MEAL_CALORIES
  ) {
    return today.caloriesRemaining < 0
      ? 'Today’s calorie target is already exceeded. Do not add a large meal solely for the protein gap; plan the protein source earlier tomorrow.'
      : `Only about ${today.caloriesRemaining} kcal remain. I am not recommending another full meal; plan the protein source earlier tomorrow.`;
  }
  if (today.caloriesConsumed === 0) {
    return 'Log your first meal so I can put the rest of the day into context.';
  }
  if ((today.proteinRemainingG ?? 0) > 20) {
    return `Plan another protein-rich meal; about ${today.proteinRemainingG} g protein remain.`;
  }
  if ((today.caloriesRemaining ?? 0) > 400) {
    return `About ${today.caloriesRemaining} kcal remain. Plan them deliberately instead of improvising late in the day.`;
  }
  if ((today.waterRemainingMl ?? 0) > 500) {
    return `About ${today.waterRemainingMl} ml water remain.`;
  }
  return 'Your main daily targets are on track. Keep the rest of the evening simple and consistent.';
}

export function renderDailyCoachMessage(
  snapshot: CoachContextSnapshot,
  language: string,
  mealSuggestion: CoachMealSuggestion | null = null,
  nutritionPlanningAttempted = false
): string {
  const { today, week } = snapshot;
  if (language.toLowerCase().startsWith('de')) {
    return [
      '### Dein täglicher Coach-Check-in',
      '',
      `Heute: **${today.caloriesConsumed} / ${today.calorieTarget ?? '–'} kcal**, **${today.proteinConsumedG} / ${today.proteinTargetG ?? '–'} g Protein** und **${today.waterConsumedMl} / ${today.waterTargetMl ?? '–'} ml Wasser**.`,
      `In den letzten sieben Tagen hast du an ${week.nutritionLoggedDays} von ${week.totalDays} Tagen Ernährung erfasst und ${week.workoutCount} Trainings protokolliert.`,
      '',
      '**Nächster sinnvoller Schritt:**',
      ...(mealSuggestion
        ? renderCoachMealSuggestion(mealSuggestion, language)
        : nutritionPlanningAttempted
          ? [COACH_MEAL_INGREDIENT_QUESTIONS.de]
          : [dailyFocusDe(snapshot)]),
    ].join('\n');
  }
  return [
    '### Your daily coach check-in',
    '',
    `Today: **${today.caloriesConsumed} / ${today.calorieTarget ?? '–'} kcal**, **${today.proteinConsumedG} / ${today.proteinTargetG ?? '–'} g protein**, and **${today.waterConsumedMl} / ${today.waterTargetMl ?? '–'} ml water**.`,
    `Over the last seven days, you logged nutrition on ${week.nutritionLoggedDays} of ${week.totalDays} days and recorded ${week.workoutCount} workouts.`,
    '',
    '**Next useful step:**',
    ...(mealSuggestion
      ? renderCoachMealSuggestion(mealSuggestion, language)
      : nutritionPlanningAttempted
        ? [COACH_MEAL_INGREDIENT_QUESTIONS.en]
        : [dailyFocusEn(snapshot)]),
  ].join('\n');
}

export function renderWeeklyCoachMessage(
  snapshot: CoachContextSnapshot,
  language: string,
  mealSuggestion: CoachMealSuggestion | null = null,
  nutritionPlanningAttempted = false
): string {
  const { week, longTerm, weight30Days } = snapshot;
  const calorieDelta =
    week.averageCaloriesOnLoggedDays !== null &&
    longTerm.averageCaloriesOnLoggedDays !== null
      ? week.averageCaloriesOnLoggedDays - longTerm.averageCaloriesOnLoggedDays
      : null;
  const weightLineDe =
    weight30Days.changeKg === null
      ? `Für einen belastbaren Gewichtstrend fehlen noch Messwerte (${weight30Days.entries} in 30 Tagen).`
      : `Der 30-Tage-Gewichtstrend liegt bei **${signed(weight30Days.changeKg)} kg**.`;
  const weightLineEn =
    weight30Days.changeKg === null
      ? `More measurements are needed for a reliable weight trend (${weight30Days.entries} in 30 days).`
      : `Your 30-day weight trend is **${signed(weight30Days.changeKg)} kg**.`;

  if (language.toLowerCase().startsWith('de')) {
    return [
      '### Dein Wochenrückblick',
      '',
      `Ernährung erfasst: **${week.nutritionLoggedDays}/${week.totalDays} Tage**. Durchschnitt an erfassten Tagen: **${week.averageCaloriesOnLoggedDays ?? '–'} kcal** und **${week.averageProteinOnLoggedDaysG ?? '–'} g Protein**.`,
      `Kalorienziel innerhalb ±10 % getroffen: **${week.calorieTargetDays} Tage**. Wasser erfasst: **${week.waterLoggedDays}/${week.totalDays} Tage**. Trainings: **${week.workoutCount}**.`,
      weightLineDe,
      calorieDelta === null
        ? 'Ein Vergleich mit deinem 30-Tage-Kalorienmittel ist noch nicht belastbar.'
        : `Gegenüber deinem 30-Tage-Mittel lag diese Woche bei **${signed(calorieDelta)} kcal pro erfasstem Tag**.`,
      '',
      mealSuggestion
        ? '**Konkreter Meal-Prep-Start für die nächste Woche:**'
        : nutritionPlanningAttempted
          ? '**Meal-Prep für die nächste Woche:**'
          : '**Fokus für die nächste Woche:** Erst vollständiges Logging sichern, dann Ziele anhand des Trends beurteilen – fehlende Tage werden nicht als Nullverbrauch gewertet.',
      ...(mealSuggestion
        ? renderCoachMealSuggestion(mealSuggestion, language, 'meal-prep')
        : nutritionPlanningAttempted
          ? [COACH_MEAL_INGREDIENT_QUESTIONS.de]
          : []),
    ].join('\n');
  }
  return [
    '### Your weekly review',
    '',
    `Nutrition logged: **${week.nutritionLoggedDays}/${week.totalDays} days**. Average on logged days: **${week.averageCaloriesOnLoggedDays ?? '–'} kcal** and **${week.averageProteinOnLoggedDaysG ?? '–'} g protein**.`,
    `Calories within ±10% of target: **${week.calorieTargetDays} days**. Water logged: **${week.waterLoggedDays}/${week.totalDays} days**. Workouts: **${week.workoutCount}**.`,
    weightLineEn,
    calorieDelta === null
      ? 'There is not enough data for a reliable comparison with your 30-day calorie average.'
      : `This week was **${signed(calorieDelta)} kcal per logged day** compared with your 30-day average.`,
    '',
    mealSuggestion
      ? '**Concrete meal-prep start for next week:**'
      : nutritionPlanningAttempted
        ? '**Meal prep for next week:**'
        : '**Focus for next week:** establish complete logging first, then judge targets from the trend—missing days are never treated as zero intake.',
    ...(mealSuggestion
      ? renderCoachMealSuggestion(mealSuggestion, language, 'meal-prep')
      : nutritionPlanningAttempted
        ? [COACH_MEAL_INGREDIENT_QUESTIONS.en]
        : []),
  ].join('\n');
}

function dailyMealWouldHelp(snapshot: CoachContextSnapshot): boolean {
  if (
    snapshot.trainingSchedule?.dueToday.some((workout) => !workout.completed)
  ) {
    return false;
  }
  if (
    snapshot.today.caloriesRemaining !== null &&
    snapshot.today.caloriesRemaining < MIN_COACH_MEAL_CALORIES
  ) {
    return false;
  }
  return (
    snapshot.today.caloriesConsumed === 0 ||
    (snapshot.today.proteinRemainingG ?? 0) > 20 ||
    (snapshot.today.caloriesRemaining ?? 0) > 400
  );
}

async function loadMealSuggestion(
  candidate: ProactiveCoachCandidate,
  targets: CoachMealTargets,
  seed: string
): Promise<CoachMealSuggestion | null> {
  if (!candidate.proactiveCategories.includes('nutrition')) return null;
  try {
    return await getCoachMealSuggestion(candidate.userId, targets, seed);
  } catch (error) {
    log(
      'warn',
      `Failed to build a concrete coach meal suggestion for user ${candidate.userId}:`,
      error
    );
    return null;
  }
}

async function loadEveningRestockReminder(
  candidate: ProactiveCoachCandidate,
  now: Date
): Promise<CoachRestockReminder | null> {
  if (!candidate.proactiveCategories.includes('nutrition')) return null;
  const local = instantHourMinute(now, candidate.timezone);
  if (local.hour * 60 + local.minute < EVENING_RESTOCK_START_MINUTES)
    return null;
  try {
    return await getRestockReminder(candidate.userId);
  } catch (error) {
    log(
      'warn',
      `Failed to build a pantry restock reminder for user ${candidate.userId}:`,
      error
    );
    return null;
  }
}

let processing = false;

export async function processDueProactiveCoachMessages(
  now = new Date()
): Promise<number> {
  if (processing) return 0;
  processing = true;
  let delivered = 0;
  try {
    const candidates =
      await coachProfileRepository.listProactiveCoachCandidates();
    for (const candidate of candidates) {
      try {
        const kinds = getDueMessageKinds(candidate, now);
        const restockCheckDue = isEveningRestockCheckDue(candidate, now);
        if (kinds.length === 0 && !restockCheckDue) continue;
        const localDate = instantToDay(now, candidate.timezone);
        const restockReminder = restockCheckDue
          ? await loadEveningRestockReminder(candidate, now)
          : null;
        if (restockReminder) {
          const content = candidate.language.toLowerCase().startsWith('de')
            ? restockReminder.textDe
            : restockReminder.textEn;
          const saved = await coachProfileRepository.saveProactiveMessageIfDue(
            candidate.userId,
            'restock',
            localDate,
            content,
            restockReminder.signature,
            { topic: 'nutrition', score: 96, tone: 'push' }
          );
          if (saved) {
            delivered++;
            coachEventService.publish(candidate.userId, 'chat');
          }
        }
        if (kinds.length === 0) continue;
        if (candidate.proactiveCategories.includes('training')) {
          await plannedWorkoutScheduleService.carryForwardMissedWorkouts(
            candidate.userId,
            localDate
          );
        }
        const snapshot = await coachContextService.getCoachContextSnapshot(
          candidate.userId,
          candidate.timezone
        );
        const scheduledKinds = kinds.filter((kind) => kind !== 'adaptive');
        const kindsToProcess =
          scheduledKinds.length > 0
            ? scheduledKinds
            : restockReminder
              ? []
              : kinds;
        if (
          kinds.includes('adaptive') &&
          (scheduledKinds.length > 0 || restockReminder)
        ) {
          const adaptiveDeliveryKey = getAdaptiveDeliverySlot(candidate, now);
          if (adaptiveDeliveryKey) {
            await coachProfileRepository.markAdaptiveSlotObserved(
              candidate.userId,
              adaptiveDeliveryKey
            );
          }
        }
        for (const kind of kindsToProcess) {
          const deliveryKey =
            kind === 'adaptive'
              ? getAdaptiveDeliverySlot(candidate, now)
              : localDate;
          if (!deliveryKey) continue;
          if (kind === 'adaptive') {
            const recentMessages =
              await coachProfileRepository.listRecentProactiveMessages(
                candidate.userId
              );
            const decision = evaluateProactiveCoachOpportunity({
              snapshot,
              categories: candidate.proactiveCategories,
              timezone: candidate.timezone,
              now,
              minimumMessageIntervalMinutes: candidate.adaptiveIntervalMinutes,
              lastAdaptiveMessageAt: candidate.adaptiveCooldownLastMessageAt,
              lastUserMessageAt: candidate.lastUserMessageAt,
              recentMessages,
            });
            if (!decision.shouldSend || !decision.opportunity) {
              await coachProfileRepository.markAdaptiveSlotObserved(
                candidate.userId,
                deliveryKey
              );
              log(
                'debug',
                `Proactive coach observed ${deliveryKey} for user ${candidate.userId} without sending (${decision.reason}).`
              );
              continue;
            }
            const mealSuggestion =
              decision.opportunity.topic === 'nutrition' &&
              !decision.opportunity.messageDe &&
              !decision.opportunity.messageEn
                ? await loadMealSuggestion(
                    candidate,
                    snapshot.today,
                    deliveryKey
                  )
                : null;
            const content = await composeAdaptiveCoachMessage({
              userId: candidate.userId,
              language: candidate.language,
              deliveryKey,
              snapshot,
              opportunity: decision.opportunity,
              recentMessages,
              coachingNotes: candidate.coachingNotes,
              routines: candidate.routines,
              memoryEnabled: candidate.memoryEnabled,
              mealSuggestion,
            });
            const saved =
              await coachProfileRepository.saveProactiveMessageIfDue(
                candidate.userId,
                kind,
                deliveryKey,
                content,
                decision.opportunity.stateSignature,
                decision.opportunity
              );
            if (!saved) continue;
            delivered++;
            coachEventService.publish(candidate.userId, 'chat');
            continue;
          }
          const nutritionPlanningAttempted =
            candidate.proactiveCategories.includes('nutrition') &&
            (kind === 'weekly' ||
              (kind === 'daily' &&
                !scheduledKinds.includes('weekly') &&
                dailyMealWouldHelp(snapshot)));
          const mealSuggestion = nutritionPlanningAttempted
            ? await loadMealSuggestion(
                candidate,
                kind === 'weekly'
                  ? {
                      caloriesRemaining: snapshot.today.calorieTarget,
                      proteinRemainingG: snapshot.today.proteinTargetG,
                    }
                  : snapshot.today,
                `${deliveryKey}:${kind}`
              )
            : null;
          const baseContent =
            kind === 'daily'
              ? renderDailyCoachMessage(
                  snapshot,
                  candidate.language,
                  mealSuggestion,
                  nutritionPlanningAttempted
                )
              : renderWeeklyCoachMessage(
                  snapshot,
                  candidate.language,
                  mealSuggestion,
                  nutritionPlanningAttempted
                );
          const saved = await coachProfileRepository.saveProactiveMessageIfDue(
            candidate.userId,
            kind,
            deliveryKey,
            baseContent,
            undefined
          );
          if (!saved) continue;
          delivered++;
          coachEventService.publish(candidate.userId, 'chat');
        }
      } catch (error) {
        log(
          'error',
          `Failed to create proactive coach message for user ${candidate.userId}:`,
          error
        );
      }
    }
  } finally {
    processing = false;
  }
  if (delivered > 0) {
    log('info', `Created ${delivered} proactive coach message(s).`);
  }
  return delivered;
}

export default {
  getDueMessageKinds,
  getAdaptiveDeliverySlot,
  isEveningRestockCheckDue,
  renderAdaptiveCoachMessage,
  renderDailyCoachMessage,
  renderWeeklyCoachMessage,
  processDueProactiveCoachMessages,
};
