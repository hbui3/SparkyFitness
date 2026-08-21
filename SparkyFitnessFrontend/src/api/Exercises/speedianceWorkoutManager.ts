import { apiCall } from '@/api/api';
import type {
  SpeedianceExerciseSearchResponse,
  SpeedianceWorkoutDefinition,
  SpeedianceWorkoutDetail,
  SpeedianceWorkoutDeleteResponse,
  SpeedianceWorkoutListResponse,
  SpeedianceWorkoutScheduleResponse,
  SpeedianceWorkoutUpsertResponse,
} from '@workspace/shared';

export function listSpeedianceWorkouts(
  providerId?: string
): Promise<SpeedianceWorkoutListResponse> {
  return apiCall('/integrations/speediance/workouts', {
    method: 'GET',
    params: { providerId },
  });
}

export function getSpeedianceWorkout(
  code: string,
  providerId?: string
): Promise<SpeedianceWorkoutDetail> {
  return apiCall(
    `/integrations/speediance/workouts/${encodeURIComponent(code)}`,
    {
      method: 'GET',
      params: { providerId },
    }
  );
}

export function searchSpeedianceExercises(
  query: string,
  providerId?: string
): Promise<SpeedianceExerciseSearchResponse> {
  return apiCall('/integrations/speediance/exercises/search', {
    method: 'POST',
    body: { query, providerId, limit: 50 },
  });
}

export function saveSpeedianceWorkout(
  workout: SpeedianceWorkoutDefinition
): Promise<SpeedianceWorkoutUpsertResponse> {
  return apiCall('/integrations/speediance/workouts', {
    method: 'POST',
    body: workout,
  });
}

export function setSpeedianceReservation(
  code: string,
  date: string,
  scheduled: boolean,
  providerId?: string
): Promise<SpeedianceWorkoutScheduleResponse> {
  return apiCall(
    `/integrations/speediance/workouts/${encodeURIComponent(code)}/reservation`,
    {
      method: 'POST',
      body: { date, scheduled, providerId },
    }
  );
}

export function deleteSpeedianceWorkout(
  id: string,
  remoteCode: string,
  confirmName: string,
  providerId?: string
): Promise<SpeedianceWorkoutDeleteResponse> {
  return apiCall(
    `/integrations/speediance/workouts/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      body: { remoteCode, confirmName, providerId },
    }
  );
}
