import {
  instantToDay,
  todayInZone,
  type CoachTrainingPreference,
  type CoachWorkoutFeedback,
  type RecordTrainingFeedbackRequest,
  type RecordTrainingFeedbackResponse,
  type SetTrainingPreferenceRequest,
  type TrainingFeedbackResponse,
  type TrainingLearningContext,
  type TrainingPreferenceResponse,
} from '@workspace/shared';
import coachTrainingFeedbackRepository from '../models/coachTrainingFeedbackRepository.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';

const RECENT_FEEDBACK_LIMIT = 12;
const MAX_CONTEXT_PREFERENCES = 30;
const MAX_CONTEXT_NOTE_LENGTH = 240;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function compactText(value: string | null, maximum: number): string | null {
  if (!value) return null;
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function dayString(value: string | Date): string {
  return typeof value === 'string'
    ? value.slice(0, 10)
    : instantToDay(value, 'UTC');
}

function toPreferenceResponse(
  preference: CoachTrainingPreference
): TrainingPreferenceResponse {
  return {
    id: preference.id,
    kind: preference.kind,
    subject: preference.subject,
    sentiment: preference.sentiment,
    notes: preference.notes,
    source: preference.source,
    active: preference.active,
    updatedAt: new Date(preference.updated_at).toISOString(),
  };
}

function toFeedbackResponse(
  feedback: CoachWorkoutFeedback
): TrainingFeedbackResponse {
  return {
    id: feedback.id,
    workoutDate: dayString(feedback.workout_date),
    workoutName: feedback.workout_name,
    provider: feedback.provider,
    overallRating: feedback.overall_rating,
    difficulty: feedback.difficulty,
    energyRating: feedback.energy_rating,
    painLevel: feedback.pain_level,
    notes: feedback.notes,
    exerciseFeedback: feedback.exercise_feedback,
    createdAt: new Date(feedback.created_at).toISOString(),
  };
}

function feedbackAdjustment(feedback: CoachWorkoutFeedback): number {
  let adjustment = 0;
  if (feedback.difficulty === 'too_easy') adjustment += 0.05;
  if (feedback.difficulty === 'too_hard') adjustment -= 0.1;
  if (feedback.overall_rating !== null && feedback.overall_rating <= 2) {
    adjustment -= 0.05;
  }
  if (feedbackHasPain(feedback)) {
    adjustment -= 0.1;
  }
  return adjustment;
}

function feedbackHasPain(feedback: CoachWorkoutFeedback): boolean {
  return (
    (feedback.pain_level ?? 0) >= 4 ||
    feedback.exercise_feedback.some(
      (exercise) => (exercise.discomfortLevel ?? 0) >= 4
    )
  );
}

function buildLearningContext(
  preferences: CoachTrainingPreference[],
  feedback: CoachWorkoutFeedback[]
): TrainingLearningContext {
  const adaptationSamples = feedback.slice(0, 6);
  const totalAdjustment = adaptationSamples.reduce(
    (sum, item) => sum + feedbackAdjustment(item),
    0
  );
  const averageAdjustment =
    adaptationSamples.length === 0
      ? 0
      : totalAdjustment / adaptationSamples.length;
  const recentPainReported = feedback.slice(0, 3).some(feedbackHasPain);
  const suggestedVolumeFactor = Number(
    clamp(1 + averageAdjustment, 0.8, 1.1).toFixed(2)
  );
  const active = preferences.filter((item) => item.active);
  return {
    suggestedVolumeFactor,
    suggestedRestSecondsDelta:
      recentPainReported ||
      feedback.slice(0, 3).some((item) => item.difficulty === 'too_hard')
        ? 15
        : 0,
    recentPainReported,
    preferredExercises: active
      .filter((item) => item.kind === 'exercise' && item.sentiment === 'prefer')
      .map((item) => item.subject),
    avoidedExercises: active
      .filter((item) => item.kind === 'exercise' && item.sentiment === 'avoid')
      .map((item) => item.subject),
    requiredEquipment: active
      .filter(
        (item) => item.kind === 'equipment' && item.sentiment === 'require'
      )
      .map((item) => item.subject),
    constraints: active
      .filter(
        (item) => item.kind === 'constraint' && item.sentiment !== 'neutral'
      )
      .map((item) =>
        item.notes ? `${item.subject}: ${item.notes}` : item.subject
      ),
    preferences: active.map(toPreferenceResponse),
    recentFeedback: feedback.map(toFeedbackResponse),
  };
}

export async function getTrainingLearningContext(
  userId: string
): Promise<TrainingLearningContext> {
  const [preferences, feedback] = await Promise.all([
    coachTrainingFeedbackRepository.listActivePreferences(userId),
    coachTrainingFeedbackRepository.listRecentFeedback(
      userId,
      RECENT_FEEDBACK_LIMIT
    ),
  ]);
  return buildLearningContext(preferences, feedback);
}

export async function recordTrainingFeedback(
  userId: string,
  input: RecordTrainingFeedbackRequest,
  timezone?: string
): Promise<RecordTrainingFeedbackResponse> {
  const resolvedTimezone = timezone ?? (await loadUserTimezone(userId));
  const result =
    await coachTrainingFeedbackRepository.recordFeedbackWithPreferences(
      userId,
      {
        ...input,
        workoutDate: input.workoutDate ?? todayInZone(resolvedTimezone),
      }
    );
  return {
    success: true,
    feedback: toFeedbackResponse(result.feedback),
    updatedPreferences: result.preferences.map(toPreferenceResponse),
    learningContext: await getTrainingLearningContext(userId),
  };
}

export async function setTrainingPreference(
  userId: string,
  input: SetTrainingPreferenceRequest
): Promise<TrainingPreferenceResponse> {
  return toPreferenceResponse(
    await coachTrainingFeedbackRepository.upsertPreference(
      userId,
      input,
      'user'
    )
  );
}

export async function forgetTrainingPreference(
  userId: string,
  preferenceId: string
): Promise<boolean> {
  return coachTrainingFeedbackRepository.deactivatePreference(
    userId,
    preferenceId
  );
}

export function formatTrainingLearningContext(
  context: TrainingLearningContext
): string[] {
  if (context.preferences.length === 0 && context.recentFeedback.length === 0) {
    return [];
  }
  const lines = [
    `Training feedback adaptation: suggested volume factor ${context.suggestedVolumeFactor.toFixed(2)}; add ${context.suggestedRestSecondsDelta}s rest where appropriate; recent pain/discomfort reported: ${context.recentPainReported ? 'yes' : 'no'}.`,
  ];
  if (context.preferences.length > 0) {
    lines.push(
      'Active training preferences:\n' +
        context.preferences
          .slice(0, MAX_CONTEXT_PREFERENCES)
          .map((preference) => {
            const notes = compactText(
              preference.notes,
              MAX_CONTEXT_NOTE_LENGTH
            );
            return `- ${preference.id}: [${preference.kind}/${preference.sentiment}] ${preference.subject}${notes ? ` — ${notes}` : ''}`;
          })
          .join('\n')
    );
  }
  if (context.recentFeedback.length > 0) {
    lines.push(
      'Recent workout feedback:\n' +
        context.recentFeedback
          .slice(0, 6)
          .map((feedback) => {
            const notes = compactText(feedback.notes, MAX_CONTEXT_NOTE_LENGTH);
            return `- ${feedback.workoutDate} ${feedback.workoutName}: rating ${feedback.overallRating ?? 'n/a'}/5, difficulty ${feedback.difficulty ?? 'n/a'}, pain ${feedback.painLevel ?? 'n/a'}/10${notes ? ` — ${notes}` : ''}`;
          })
          .join('\n')
    );
  }
  return lines;
}

export default {
  getTrainingLearningContext,
  recordTrainingFeedback,
  setTrainingPreference,
  forgetTrainingPreference,
  formatTrainingLearningContext,
};
