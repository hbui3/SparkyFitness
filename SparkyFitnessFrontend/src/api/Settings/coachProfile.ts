import { apiCall } from '@/api/api';
import type {
  CoachProfileResponse,
  UpdateCoachProfileRequest,
  ValidateMealSuggestionResponse,
} from '@workspace/shared';

export const getCoachProfile = (): Promise<CoachProfileResponse> =>
  apiCall('/coach-profile');

export const updateCoachProfile = (
  profile: UpdateCoachProfileRequest
): Promise<CoachProfileResponse> =>
  apiCall('/coach-profile', {
    method: 'PUT',
    body: JSON.stringify(profile),
  });

export const validateMealSuggestion = (
  ingredients: string[]
): Promise<ValidateMealSuggestionResponse> =>
  apiCall('/coach-profile/validate-meal', {
    method: 'POST',
    body: JSON.stringify({ ingredients }),
  });
