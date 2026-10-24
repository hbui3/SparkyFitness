import { apiCall } from '@/api/api';
import {
  workoutCoachingSettingsSchema,
  workoutCoachingSignalsResponseSchema,
  workoutSessionFeedbackResponseSchema,
  type UpdateWorkoutSessionFeedbackRequest,
  type WorkoutCoachingSettings,
  type WorkoutCoachingSignalsResponse,
  type WorkoutSessionFeedbackResponse,
} from '@workspace/shared';

/** `/v2/workout-coaching` — session feedback and adaptive settings (#1560). */

export const getWorkoutSessionFeedback = async (
  presetEntryId: string
): Promise<WorkoutSessionFeedbackResponse> =>
  workoutSessionFeedbackResponseSchema.parse(
    await apiCall(
      `/v2/workout-coaching/sessions/${encodeURIComponent(presetEntryId)}/feedback`,
      { method: 'GET' }
    )
  );

export const saveWorkoutSessionFeedback = async (
  presetEntryId: string,
  request: UpdateWorkoutSessionFeedbackRequest
): Promise<WorkoutSessionFeedbackResponse> =>
  workoutSessionFeedbackResponseSchema.parse(
    await apiCall(
      `/v2/workout-coaching/sessions/${encodeURIComponent(presetEntryId)}/feedback`,
      { method: 'PUT', body: JSON.stringify(request) }
    )
  );

export const getWorkoutCoachingSettings =
  async (): Promise<WorkoutCoachingSettings> =>
    workoutCoachingSettingsSchema.parse(
      await apiCall('/v2/workout-coaching/settings', { method: 'GET' })
    );

export const saveWorkoutCoachingSettings = async (
  settings: WorkoutCoachingSettings
): Promise<WorkoutCoachingSettings> =>
  workoutCoachingSettingsSchema.parse(
    await apiCall('/v2/workout-coaching/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    })
  );

/** Recent-history signals behind adaptive suggestions for these exercises. */
export const getWorkoutCoachingSignals = async (
  exerciseIds: readonly string[]
): Promise<WorkoutCoachingSignalsResponse> =>
  workoutCoachingSignalsResponseSchema.parse(
    await apiCall('/v2/workout-coaching/signals', {
      method: 'GET',
      params: { exerciseIds: exerciseIds.join(',') },
    })
  );
