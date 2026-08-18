import { dayOfWeek, instantHourMinute, instantToDay } from '@workspace/shared';
import coachProfileRepository, {
  type ProactiveCoachCandidate,
  type ProactiveCoachMessageKind,
} from '../models/coachProfileRepository.js';
import coachContextService, {
  type CoachContextSnapshot,
} from './coachContextService.js';
import { log } from '../config/logging.js';

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

export function getDueMessageKinds(
  candidate: ProactiveCoachCandidate,
  now: Date
): ProactiveCoachMessageKind[] {
  const kinds: ProactiveCoachMessageKind[] = [];
  const localDate = instantToDay(now, candidate.timezone);
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
          const content =
            kind === 'daily'
              ? renderDailyCoachMessage(snapshot, candidate.language)
              : renderWeeklyCoachMessage(snapshot, candidate.language);
          const saved = await coachProfileRepository.saveProactiveMessageIfDue(
            candidate.userId,
            kind,
            localDate,
            content
          );
          if (saved) delivered++;
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
  renderDailyCoachMessage,
  renderWeeklyCoachMessage,
  processDueProactiveCoachMessages,
};
