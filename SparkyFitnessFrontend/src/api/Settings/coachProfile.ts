import { apiCall } from '@/api/api';
import type {
  CoachProfileResponse,
  CoachTelegramConnectionStatus,
  CoachTelegramDisconnectResponse,
  CoachTelegramLinkResponse,
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

export const getCoachTelegramStatus =
  (): Promise<CoachTelegramConnectionStatus> =>
    apiCall('/coach-profile/telegram');

export const createCoachTelegramLink = (): Promise<CoachTelegramLinkResponse> =>
  apiCall('/coach-profile/telegram/link', { method: 'POST' });

export const disconnectCoachTelegram =
  (): Promise<CoachTelegramDisconnectResponse> =>
    apiCall('/coach-profile/telegram', { method: 'DELETE' });

export const validateMealSuggestion = (
  ingredients: string[]
): Promise<ValidateMealSuggestionResponse> =>
  apiCall('/coach-profile/validate-meal', {
    method: 'POST',
    body: JSON.stringify({ ingredients }),
  });
