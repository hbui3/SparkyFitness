import { instantHourMinute } from '@workspace/shared';
import { createHash } from 'node:crypto';
import type { CoachContextSnapshot } from './coachContextService.js';
import type {
  ProactiveCoachOpportunity,
  ProactiveCoachTone,
  ProactiveCoachTopic,
  RecentProactiveCoachMessage,
} from '../types/proactiveCoach.js';
import { MIN_COACH_MEAL_CALORIES } from './coachMealSuggestionService.js';

const MINIMUM_RELEVANCE_SCORE = 70;
const ACTIVE_CONVERSATION_COOLDOWN_MINUTES = 20;

const TOPIC_COOLDOWN_MINUTES: Record<ProactiveCoachTopic, number> = {
  recovery: 8 * 60,
  training: 6 * 60,
  nutrition: 4 * 60,
  hydration: 4 * 60,
  progress: 24 * 60,
  consistency: 24 * 60,
};

export interface ProactiveCoachDecisionInput {
  snapshot: CoachContextSnapshot;
  categories: readonly string[];
  timezone: string;
  now: Date;
  minimumMessageIntervalMinutes: number;
  lastAdaptiveMessageAt: string | null;
  lastUserMessageAt: string | null;
  recentMessages: readonly RecentProactiveCoachMessage[];
}

export interface ProactiveCoachDecision {
  shouldSend: boolean;
  reason:
    | 'relevant'
    | 'global_cooldown'
    | 'active_conversation'
    | 'no_relevant_opportunity'
    | 'topic_cooldown'
    | 'unchanged_opportunity';
  opportunity: ProactiveCoachOpportunity | null;
}

interface OpportunityDraft {
  topic: ProactiveCoachTopic;
  score: number;
  tone: ProactiveCoachTone;
  summaryDe: string;
  summaryEn: string;
  actionDe: string;
  actionEn: string;
  signatureFacts: Record<string, unknown>;
  messageDe?: string;
  messageEn?: string;
}

function minutesSince(value: string | null, now: Date): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, (now.getTime() - parsed) / 60_000);
}

function ratio(value: number, target: number | null): number | null {
  if (target === null || target <= 0) return null;
  return value / target;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function opportunitySignature(draft: OpportunityDraft, date: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        date,
        topic: draft.topic,
        facts: draft.signatureFacts,
      })
    )
    .digest('hex');
}

function completeOpportunity(
  draft: OpportunityDraft,
  date: string
): ProactiveCoachOpportunity {
  return {
    topic: draft.topic,
    score: clamp(Math.round(draft.score), 0, 100),
    tone: draft.tone,
    summaryDe: draft.summaryDe,
    summaryEn: draft.summaryEn,
    actionDe: draft.actionDe,
    actionEn: draft.actionEn,
    stateSignature: opportunitySignature(draft, date),
    ...(draft.messageDe ? { messageDe: draft.messageDe } : {}),
    ...(draft.messageEn ? { messageEn: draft.messageEn } : {}),
  };
}

function buildOpportunities(
  snapshot: CoachContextSnapshot,
  categories: readonly string[],
  localMinutes: number
): ProactiveCoachOpportunity[] {
  const opportunities: OpportunityDraft[] = [];
  const { today, week, weight30Days, recovery, adaptiveTraining } = snapshot;
  const dayProgress = clamp((localMinutes - 8 * 60) / (12 * 60), 0, 1);
  const recoveryIsCritical =
    (recovery.trainingReadinessScore !== null &&
      recovery.trainingReadinessScore < 45) ||
    (recovery.sleepScore !== null && recovery.sleepScore < 55);
  const dueWorkout = snapshot.trainingSchedule?.dueToday.find(
    (workout) => !workout.completed
  );
  const missedWorkout = snapshot.trainingSchedule?.missedYesterday.find(
    (workout) => workout.workoutPresetId === dueWorkout?.workoutPresetId
  );

  if (categories.includes('recovery')) {
    const readiness = recovery.trainingReadinessScore;
    const sleepScore = recovery.sleepScore;
    if (recoveryIsCritical) {
      const score = Math.max(
        readiness === null ? 0 : 125 - readiness,
        sleepScore === null ? 0 : 115 - sleepScore
      );
      opportunities.push({
        topic: 'recovery',
        score,
        tone: 'protect',
        summaryDe: `Deine Erholung ist heute deutlich unter deinem normalen Leistungsfenster${readiness === null ? '' : ` (Readiness ${readiness}/100)`}${sleepScore === null ? '' : ` (Schlaf ${sleepScore}/100)`}.`,
        summaryEn: `Your recovery is clearly below your normal performance window today${readiness === null ? '' : ` (readiness ${readiness}/100)`}${sleepScore === null ? '' : ` (sleep ${sleepScore}/100)`}.`,
        actionDe:
          'Nimm Intensität raus und sichere dir heute mit lockerer Bewegung und frühem Schlaf den nächsten guten Trainingstag.',
        actionEn:
          'Reduce the intensity and use easy movement plus an early night to protect your next strong training day.',
        signatureFacts: { readiness, sleepScore },
      });
    }
  }

  if (categories.includes('training')) {
    if (
      !recoveryIsCritical &&
      dueWorkout &&
      (missedWorkout || localMinutes >= 10 * 60)
    ) {
      const lateDay = localMinutes >= 15 * 60;
      opportunities.push({
        topic: 'training',
        score: missedWorkout ? 94 : lateDay ? 92 : 80,
        tone: 'push',
        summaryDe: missedWorkout
          ? `Du hast „${missedWorkout.name}“ gestern nicht absolviert. Es wurde deshalb auf heute vorgezogen und wartet noch auf dich.`
          : `Dein konkret geplantes Training „${dueWorkout.name}“ steht heute noch aus.`,
        summaryEn: missedWorkout
          ? `You did not complete “${missedWorkout.name}” yesterday. It was carried forward and is still waiting for you today.`
          : `Your scheduled workout “${dueWorkout.name}” is still due today.`,
        actionDe: lateDay
          ? 'Lege jetzt eine konkrete Startzeit fest – oder sag mir den echten Hinderungsgrund, damit wir den Plan bewusst anpassen.'
          : 'Blocke jetzt ein realistisches Zeitfenster dafür, bevor der Tag es dir wieder wegverhandelt.',
        actionEn: lateDay
          ? 'Set a concrete start time now—or tell me the real constraint so we can adjust the plan deliberately.'
          : 'Block a realistic time window now before the day negotiates it away again.',
        signatureFacts: {
          workoutPresetId: dueWorkout.workoutPresetId,
          workoutPlanAssignmentId: dueWorkout.workoutPlanAssignmentId,
          carriedForward: Boolean(missedWorkout),
          phase: lateDay ? 'late' : 'day',
        },
      });
    } else if (adaptiveTraining.status === 'completed') {
      opportunities.push({
        topic: 'training',
        score: 90,
        tone: 'celebrate',
        summaryDe: `Das heutige Training „${adaptiveTraining.presetName ?? 'Training'}“ ist erledigt.`,
        summaryEn: `Today's “${adaptiveTraining.presetName ?? 'workout'}” is done.`,
        actionDe:
          'Nimm den Sieg mit: kurz runterfahren, trinken und die nächste Mahlzeit proteinreich aufbauen.',
        actionEn:
          'Bank the win: cool down, hydrate, and make the next meal protein-forward.',
        signatureFacts: {
          status: adaptiveTraining.status,
          presetId: adaptiveTraining.presetId,
        },
      });
    } else if (
      !recoveryIsCritical &&
      adaptiveTraining.kind === 'workout' &&
      localMinutes >= 10 * 60
    ) {
      const lateDay = localMinutes >= 15 * 60;
      opportunities.push({
        topic: 'training',
        score: lateDay ? 88 : 74,
        tone: 'push',
        summaryDe: `Dein passendes Training für heute ist „${adaptiveTraining.presetName ?? 'Training'}“ (Fit ${adaptiveTraining.score}/100), aber es wartet noch auf dich.`,
        summaryEn: `Today's best-fit session is “${adaptiveTraining.presetName ?? 'workout'}” (fit ${adaptiveTraining.score}/100), and it is still waiting for you.`,
        actionDe: lateDay
          ? 'Lege jetzt eine konkrete Startzeit fest – nicht später „irgendwann“, sondern mit Uhrzeit.'
          : 'Blocke jetzt das Zeitfenster dafür, damit der Rest des Tages es dir nicht wegverhandelt.',
        actionEn: lateDay
          ? 'Set a concrete start time now—not “later,” but an actual time.'
          : 'Block the time for it now so the rest of the day cannot negotiate it away.',
        signatureFacts: {
          status: adaptiveTraining.status,
          presetId: adaptiveTraining.presetId,
          phase: lateDay ? 'late' : 'day',
        },
      });
    } else if (
      adaptiveTraining.kind === 'recovery' &&
      localMinutes >= 14 * 60
    ) {
      opportunities.push({
        topic: 'recovery',
        score: 72,
        tone: 'protect',
        summaryDe:
          'Der Plan sieht heute bewusst Erholung statt eines harten Trainings vor.',
        summaryEn:
          'The plan deliberately calls for recovery instead of a hard session today.',
        actionDe:
          'Mach daraus einen aktiven Erfolg: 20–30 Minuten locker bewegen und ohne schlechtes Gewissen regenerieren.',
        actionEn:
          'Turn that into an active win: move easily for 20–30 minutes and recover without guilt.',
        signatureFacts: {
          kind: adaptiveTraining.kind,
          score: adaptiveTraining.score,
        },
      });
    }
  }

  if (categories.includes('nutrition')) {
    const proteinRatio = ratio(today.proteinConsumedG, today.proteinTargetG);
    const hasMealCalorieBudget =
      today.caloriesRemaining === null ||
      today.caloriesRemaining >= MIN_COACH_MEAL_CALORIES;
    if (
      hasMealCalorieBudget &&
      today.caloriesConsumed === 0 &&
      localMinutes >= 9 * 60
    ) {
      const phase =
        localMinutes >= 14 * 60
          ? 'late'
          : localMinutes >= 11 * 60
            ? 'midday'
            : 'morning';
      opportunities.push({
        topic: 'nutrition',
        score: phase === 'late' ? 86 : phase === 'midday' ? 78 : 72,
        tone: 'push',
        summaryDe:
          'Für heute ist noch keine Mahlzeit erfasst; ohne konkrete Essensentscheidung wird später leicht improvisiert.',
        summaryEn:
          'No meal is logged today; without a concrete food decision it is easy to improvise later.',
        actionDe:
          'Lege jetzt eine passende Mahlzeit mit genauen Mengen fest und kaufe direkt für zwei Portionen ein.',
        actionEn:
          'Set one suitable meal with exact quantities now and shop for two servings at once.',
        signatureFacts: {
          caloriesConsumed: 0,
          phase,
        },
      });
    } else if (
      proteinRatio !== null &&
      hasMealCalorieBudget &&
      localMinutes >= 13 * 60 &&
      proteinRatio < Math.max(0.25, dayProgress - 0.2) &&
      (today.proteinRemainingG ?? 0) >= 25
    ) {
      opportunities.push({
        topic: 'nutrition',
        score: 74 + Math.min(14, Math.round((1 - proteinRatio) * 14)),
        tone: 'push',
        summaryDe: `Beim Protein bist du erst bei ${today.proteinConsumedG} von ${today.proteinTargetG} g.`,
        summaryEn: `Protein is only at ${today.proteinConsumedG} of ${today.proteinTargetG} g.`,
        actionDe: `Lege jetzt eine konkrete Mahlzeit mit etwa ${Math.min(45, today.proteinRemainingG ?? 0)} g Protein, genauen Mengen und den fehlenden Einkaufszutaten fest.`,
        actionEn: `Set one concrete meal now with roughly ${Math.min(45, today.proteinRemainingG ?? 0)} g protein, exact quantities, and the missing shopping items.`,
        signatureFacts: {
          proteinConsumedG: today.proteinConsumedG,
          proteinRemainingG: today.proteinRemainingG,
          phase: localMinutes >= 17 * 60 ? 'evening' : 'day',
        },
      });
    } else if (
      localMinutes >= 17 * 60 &&
      today.caloriesConsumed > 0 &&
      (today.caloriesRemaining ?? 0) >= 0 &&
      (proteinRatio === null || proteinRatio >= 0.8)
    ) {
      opportunities.push({
        topic: 'progress',
        score: 72,
        tone: 'celebrate',
        summaryDe:
          'Deine erfassten Ernährungswerte liegen heute sauber auf Kurs.',
        summaryEn: 'Your logged nutrition is cleanly on track today.',
        actionDe:
          'Halte den Abend genauso unspektakulär gut: eine passende Mahlzeit, kein unnötiges Nachsteuern.',
        actionEn:
          'Keep the evening just as quietly strong: one suitable meal and no unnecessary over-correction.',
        signatureFacts: {
          caloriesRemaining: today.caloriesRemaining,
          proteinConsumedG: today.proteinConsumedG,
        },
      });
    }
  }

  if (categories.includes('hydration')) {
    const waterRatio = ratio(today.waterConsumedMl, today.waterTargetMl);
    if (
      waterRatio !== null &&
      localMinutes >= 10 * 60 &&
      waterRatio < Math.max(0.2, dayProgress - 0.2) &&
      (today.waterRemainingMl ?? 0) >= 500
    ) {
      opportunities.push({
        topic: 'hydration',
        score: 72 + Math.min(14, Math.round((1 - waterRatio) * 14)),
        tone: 'push',
        summaryDe: `Beim Wasser stehen ${today.waterConsumedMl} von ${today.waterTargetMl} ml – für diese Tageszeit ist das zu wenig.`,
        summaryEn: `Water is at ${today.waterConsumedMl} of ${today.waterTargetMl} ml, which is behind for this time of day.`,
        actionDe: `Trink jetzt ${Math.min(500, today.waterRemainingMl ?? 0)} ml und stell dir die nächste Portion direkt bereit.`,
        actionEn: `Drink ${Math.min(500, today.waterRemainingMl ?? 0)} ml now and set up the next serving immediately.`,
        signatureFacts: {
          waterConsumedMl: today.waterConsumedMl,
          waterRemainingMl: today.waterRemainingMl,
          phase: localMinutes >= 17 * 60 ? 'evening' : 'day',
        },
      });
    } else if (
      waterRatio !== null &&
      waterRatio >= 1 &&
      localMinutes >= 15 * 60
    ) {
      opportunities.push({
        topic: 'progress',
        score: 70,
        tone: 'celebrate',
        summaryDe: `Dein Wasserziel von ${today.waterTargetMl} ml ist heute bereits erreicht.`,
        summaryEn: `You have already reached today's ${today.waterTargetMl} ml water target.`,
        actionDe:
          'Genau diese kleinen Standards machen Fortschritt verlässlich – halte den Rhythmus.',
        actionEn:
          'These small standards are what make progress reliable—keep the rhythm.',
        signatureFacts: { waterTargetReached: true },
      });
    }
  }

  const goalProgress =
    weight30Days.entries >= 3 && weight30Days.changeKg !== null
      ? (today.primaryGoal === 'lose_weight' && weight30Days.changeKg < 0) ||
        (today.primaryGoal === 'gain_weight' && weight30Days.changeKg > 0)
      : false;
  if (goalProgress) {
    opportunities.push({
      topic: 'progress',
      score: 84,
      tone: 'celebrate',
      summaryDe: `Dein 30-Tage-Trend bewegt sich mit ${weight30Days.changeKg} kg in Richtung deines Ziels.`,
      summaryEn: `Your 30-day trend is moving toward your goal by ${weight30Days.changeKg} kg.`,
      actionDe:
        'Das ist kein Zufall, sondern die Summe deiner Wiederholungen. Bleib bei dem, was gerade funktioniert.',
      actionEn:
        'That is not luck; it is the sum of your repetitions. Stay with what is working.',
      signatureFacts: {
        primaryGoal: today.primaryGoal,
        changeKg: weight30Days.changeKg,
        entries: weight30Days.entries,
      },
    });
  }

  if (week.nutritionLoggedDays >= 6 || week.workoutCount >= 3) {
    opportunities.push({
      topic: 'consistency',
      score: week.nutritionLoggedDays === 7 ? 80 : 74,
      tone: 'celebrate',
      summaryDe: `Diese Woche stehen ${week.nutritionLoggedDays} erfasste Ernährungstage und ${week.workoutCount} Trainings.`,
      summaryEn: `This week has ${week.nutritionLoggedDays} nutrition-logging days and ${week.workoutCount} workouts.`,
      actionDe:
        'Das ist die Art von Konstanz, die Ergebnisse produziert. Sichere heute einfach die nächste Wiederholung.',
      actionEn:
        'That is the kind of consistency that produces results. Just secure the next repetition today.',
      signatureFacts: {
        nutritionLoggedDays: week.nutritionLoggedDays,
        workoutCount: week.workoutCount,
      },
    });
  }

  return opportunities
    .map((draft) => completeOpportunity(draft, today.date))
    .sort((left, right) => right.score - left.score);
}

function recentMessageForTopic(
  recentMessages: readonly RecentProactiveCoachMessage[],
  topic: ProactiveCoachTopic
): RecentProactiveCoachMessage | undefined {
  return recentMessages.find((message) => message.topic === topic);
}

export function evaluateProactiveCoachOpportunity(
  input: ProactiveCoachDecisionInput
): ProactiveCoachDecision {
  const sinceLastMessage = minutesSince(input.lastAdaptiveMessageAt, input.now);
  if (
    sinceLastMessage !== null &&
    sinceLastMessage < input.minimumMessageIntervalMinutes
  ) {
    return { shouldSend: false, reason: 'global_cooldown', opportunity: null };
  }

  const sinceLastUserMessage = minutesSince(input.lastUserMessageAt, input.now);
  if (
    sinceLastUserMessage !== null &&
    sinceLastUserMessage < ACTIVE_CONVERSATION_COOLDOWN_MINUTES
  ) {
    return {
      shouldSend: false,
      reason: 'active_conversation',
      opportunity: null,
    };
  }

  const local = instantHourMinute(input.now, input.timezone);
  const opportunities = buildOpportunities(
    input.snapshot,
    input.categories,
    local.hour * 60 + local.minute
  ).filter((opportunity) => opportunity.score >= MINIMUM_RELEVANCE_SCORE);

  if (opportunities.length === 0) {
    return {
      shouldSend: false,
      reason: 'no_relevant_opportunity',
      opportunity: null,
    };
  }

  let sawTopicCooldown = false;
  let sawUnchangedOpportunity = false;
  for (const opportunity of opportunities) {
    const recent = recentMessageForTopic(
      input.recentMessages,
      opportunity.topic
    );
    if (!recent) {
      return { shouldSend: true, reason: 'relevant', opportunity };
    }
    const ageMinutes = minutesSince(recent.createdAt, input.now);
    if (
      ageMinutes !== null &&
      ageMinutes < TOPIC_COOLDOWN_MINUTES[opportunity.topic]
    ) {
      sawTopicCooldown = true;
      continue;
    }
    if (
      recent.stateSignature === opportunity.stateSignature &&
      ageMinutes !== null &&
      ageMinutes < 24 * 60
    ) {
      sawUnchangedOpportunity = true;
      continue;
    }
    return { shouldSend: true, reason: 'relevant', opportunity };
  }

  return {
    shouldSend: false,
    reason: sawUnchangedOpportunity
      ? 'unchanged_opportunity'
      : sawTopicCooldown
        ? 'topic_cooldown'
        : 'no_relevant_opportunity',
    opportunity: null,
  };
}

export default { evaluateProactiveCoachOpportunity };
