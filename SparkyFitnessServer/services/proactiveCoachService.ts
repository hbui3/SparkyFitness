import { dayOfWeek, instantHourMinute, instantToDay } from '@workspace/shared';
import coachProfileRepository, {
  type ProactiveCoachCandidate,
  type ProactiveCoachMessageKind,
} from '../models/coachProfileRepository.js';
import coachContextService, {
  type CoachContextSnapshot,
} from './coachContextService.js';
import telegramCoachService from './telegramCoachService.js';
import { log } from '../config/logging.js';

export const ADAPTIVE_COACH_START_MINUTES = 7 * 60;
export const ADAPTIVE_COACH_END_MINUTES = 20 * 60;
export const ADAPTIVE_COACH_INTERVAL_MINUTES = 2 * 60;

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
  if (
    localMinutes < ADAPTIVE_COACH_START_MINUTES ||
    localMinutes > ADAPTIVE_COACH_END_MINUTES
  ) {
    return null;
  }
  const elapsed = localMinutes - ADAPTIVE_COACH_START_MINUTES;
  const slotMinutes =
    ADAPTIVE_COACH_START_MINUTES +
    Math.floor(elapsed / ADAPTIVE_COACH_INTERVAL_MINUTES) *
      ADAPTIVE_COACH_INTERVAL_MINUTES;
  if (slotMinutes > ADAPTIVE_COACH_END_MINUTES) return null;
  return `${instantToDay(now, candidate.timezone)}T${minuteLabel(slotMinutes)}`;
}

export function getDueMessageKinds(
  candidate: ProactiveCoachCandidate,
  now: Date
): ProactiveCoachMessageKind[] {
  const kinds: ProactiveCoachMessageKind[] = [];
  const localDate = instantToDay(now, candidate.timezone);
  const adaptiveSlot = getAdaptiveDeliverySlot(candidate, now);
  if (adaptiveSlot && candidate.adaptiveLastSentSlot !== adaptiveSlot) {
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

function targetValue(value: number | null, suffix: string): string {
  return value === null ? `– ${suffix}` : `${value} ${suffix}`;
}

function adaptiveMetricsDe(snapshot: CoachContextSnapshot): string {
  const { today } = snapshot;
  return `Aktuell: ${today.caloriesConsumed} / ${targetValue(today.calorieTarget, 'kcal')}, ${today.proteinConsumedG} / ${targetValue(today.proteinTargetG, 'g Protein')} und ${today.waterConsumedMl} / ${targetValue(today.waterTargetMl, 'ml Wasser')}. Noch offen: ${today.caloriesRemaining ?? '–'} kcal, ${today.proteinRemainingG ?? '–'} g Protein und ${today.waterRemainingMl ?? '–'} ml Wasser.`;
}

function adaptiveMetricsEn(snapshot: CoachContextSnapshot): string {
  const { today } = snapshot;
  return `Right now: ${today.caloriesConsumed} / ${targetValue(today.calorieTarget, 'kcal')}, ${today.proteinConsumedG} / ${targetValue(today.proteinTargetG, 'g protein')}, and ${today.waterConsumedMl} / ${targetValue(today.waterTargetMl, 'ml water')}. Remaining: ${today.caloriesRemaining ?? '–'} kcal, ${today.proteinRemainingG ?? '–'} g protein, and ${today.waterRemainingMl ?? '–'} ml water.`;
}

function adaptiveFocusDe(
  snapshot: CoachContextSnapshot,
  slotMinutes: number
): string {
  const { today } = snapshot;
  const slot = minuteLabel(slotMinutes);
  if (today.caloriesConsumed === 0) {
    if (slotMinutes >= 10 * 60) {
      return `Bis ${slot} ist noch keine Mahlzeit erfasst. Falls du schon gegessen hast, trage sie jetzt nach; sonst plane die erste Mahlzeit passend zu deinem Ziel von ${targetValue(today.calorieTarget, 'kcal')}.`;
    }
    return `Plane deinen Tag jetzt grob: Ziel sind ${targetValue(today.calorieTarget, 'kcal')}, ${targetValue(today.proteinTargetG, 'g Protein')} und ${targetValue(today.waterTargetMl, 'ml Wasser')}.`;
  }
  if (today.waterConsumedMl === 0 && slotMinutes >= 9 * 60) {
    return `Bis ${slot} ist noch kein Wasser erfasst. Starte jetzt und behalte die verbleibenden ${today.waterRemainingMl ?? '–'} ml im Blick.`;
  }
  if ((today.caloriesRemaining ?? 0) < 0) {
    return `Du liegst ${Math.abs(today.caloriesRemaining ?? 0)} kcal über deinem heutigen Ziel. Kein Ausgleich durch extremes Sparen – halte die nächste Mahlzeit einfach und proteinreich.`;
  }
  if (slotMinutes >= 12 * 60 && (today.proteinRemainingG ?? 0) > 20) {
    return `Es fehlen noch ${today.proteinRemainingG} g Protein. Plane die nächste Mahlzeit gezielt darum, statt den Rest am Abend nachholen zu müssen.`;
  }
  if ((today.waterRemainingMl ?? 0) > 500) {
    return `Beim Wasser fehlen noch ${today.waterRemainingMl} ml. Teile das auf die verbleibenden Stunden auf.`;
  }
  if (slotMinutes >= 16 * 60 && (today.caloriesRemaining ?? 0) > 400) {
    return `Es bleiben noch ${today.caloriesRemaining} kcal. Entscheide jetzt, wie Abendessen und Snack zusammen in dieses Budget passen.`;
  }
  return `Du bist bei den erfassten Hauptzielen gut unterwegs. Halte den Kurs; noch offen sind ${today.caloriesRemaining ?? '–'} kcal, ${today.proteinRemainingG ?? '–'} g Protein und ${today.waterRemainingMl ?? '–'} ml Wasser.`;
}

function adaptiveFocusEn(
  snapshot: CoachContextSnapshot,
  slotMinutes: number
): string {
  const { today } = snapshot;
  const slot = minuteLabel(slotMinutes);
  if (today.caloriesConsumed === 0) {
    if (slotMinutes >= 10 * 60) {
      return `No meal is logged by ${slot}. If you already ate, log it now; otherwise plan the first meal around your ${targetValue(today.calorieTarget, 'kcal')} target.`;
    }
    return `Sketch out today now: targets are ${targetValue(today.calorieTarget, 'kcal')}, ${targetValue(today.proteinTargetG, 'g protein')}, and ${targetValue(today.waterTargetMl, 'ml water')}.`;
  }
  if (today.waterConsumedMl === 0 && slotMinutes >= 9 * 60) {
    return `No water is logged by ${slot}. Start now and keep the remaining ${today.waterRemainingMl ?? '–'} ml in view.`;
  }
  if ((today.caloriesRemaining ?? 0) < 0) {
    return `You are ${Math.abs(today.caloriesRemaining ?? 0)} kcal above today's target. Do not compensate aggressively; keep the next meal simple and protein-rich.`;
  }
  if (slotMinutes >= 12 * 60 && (today.proteinRemainingG ?? 0) > 20) {
    return `${today.proteinRemainingG} g protein remain. Build the next meal around that instead of leaving it all for the evening.`;
  }
  if ((today.waterRemainingMl ?? 0) > 500) {
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
  slot: string
): string {
  const slotMinutes = slotMinutesFromKey(slot);
  if (language.toLowerCase().startsWith('de')) {
    return [
      `### Coach-Check um ${minuteLabel(slotMinutes)}`,
      '',
      adaptiveMetricsDe(snapshot),
      '',
      `**Jetzt sinnvoll:** ${adaptiveFocusDe(snapshot, slotMinutes)}`,
    ].join('\n');
  }
  return [
    `### Coach check at ${minuteLabel(slotMinutes)}`,
    '',
    adaptiveMetricsEn(snapshot),
    '',
    `**Useful now:** ${adaptiveFocusEn(snapshot, slotMinutes)}`,
  ].join('\n');
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function dailyFocusDe(snapshot: CoachContextSnapshot): string {
  const { today } = snapshot;
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
  language: string
): string {
  const { today, week } = snapshot;
  if (language.toLowerCase().startsWith('de')) {
    return [
      '### Dein täglicher Coach-Check-in',
      '',
      `Heute: **${today.caloriesConsumed} / ${today.calorieTarget ?? '–'} kcal**, **${today.proteinConsumedG} / ${today.proteinTargetG ?? '–'} g Protein** und **${today.waterConsumedMl} / ${today.waterTargetMl ?? '–'} ml Wasser**.`,
      `In den letzten sieben Tagen hast du an ${week.nutritionLoggedDays} von ${week.totalDays} Tagen Ernährung erfasst und ${week.workoutCount} Trainings protokolliert.`,
      '',
      `**Nächster sinnvoller Schritt:** ${dailyFocusDe(snapshot)}`,
    ].join('\n');
  }
  return [
    '### Your daily coach check-in',
    '',
    `Today: **${today.caloriesConsumed} / ${today.calorieTarget ?? '–'} kcal**, **${today.proteinConsumedG} / ${today.proteinTargetG ?? '–'} g protein**, and **${today.waterConsumedMl} / ${today.waterTargetMl ?? '–'} ml water**.`,
    `Over the last seven days, you logged nutrition on ${week.nutritionLoggedDays} of ${week.totalDays} days and recorded ${week.workoutCount} workouts.`,
    '',
    `**Next useful step:** ${dailyFocusEn(snapshot)}`,
  ].join('\n');
}

export function renderWeeklyCoachMessage(
  snapshot: CoachContextSnapshot,
  language: string
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
      '**Fokus für die nächste Woche:** Erst vollständiges Logging sichern, dann Ziele anhand des Trends beurteilen – fehlende Tage werden nicht als Nullverbrauch gewertet.',
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
    '**Focus for next week:** establish complete logging first, then judge targets from the trend—missing days are never treated as zero intake.',
  ].join('\n');
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
        if (kinds.length === 0) continue;
        const snapshot = await coachContextService.getCoachContextSnapshot(
          candidate.userId,
          candidate.timezone
        );
        const localDate = instantToDay(now, candidate.timezone);
        for (const kind of kinds) {
          const deliveryKey =
            kind === 'adaptive'
              ? getAdaptiveDeliverySlot(candidate, now)
              : localDate;
          if (!deliveryKey) continue;
          const content =
            kind === 'adaptive'
              ? renderAdaptiveCoachMessage(
                  snapshot,
                  candidate.language,
                  deliveryKey
                )
              : kind === 'daily'
                ? renderDailyCoachMessage(snapshot, candidate.language)
                : renderWeeklyCoachMessage(snapshot, candidate.language);
          const saved = await coachProfileRepository.saveProactiveMessageIfDue(
            candidate.userId,
            kind,
            deliveryKey,
            content
          );
          if (!saved) continue;
          delivered++;
          try {
            await telegramCoachService.sendProactiveCoachMessage(
              candidate.userId,
              content
            );
          } catch (error) {
            log(
              'error',
              `Failed to send proactive coach message to Telegram for user ${candidate.userId}:`,
              error
            );
          }
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
  renderAdaptiveCoachMessage,
  renderDailyCoachMessage,
  renderWeeklyCoachMessage,
  processDueProactiveCoachMessages,
};
