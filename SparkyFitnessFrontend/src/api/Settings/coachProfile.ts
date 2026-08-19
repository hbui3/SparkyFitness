import { apiCall } from '@/api/api';
import type {
  CoachProfileResponse,
  CoachMemoryResponse,
  CreateCoachMemoryRequest,
  UpdateCoachMemoryRequest,
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

export const getCoachMemories = (): Promise<CoachMemoryResponse[]> =>
  apiCall('/coach-profile/memories');

export const createCoachMemory = (
  memory: CreateCoachMemoryRequest
): Promise<CoachMemoryResponse> =>
  apiCall('/coach-profile/memories', {
    method: 'POST',
    body: JSON.stringify(memory),
  });

export const updateCoachMemory = (
  id: string,
  memory: UpdateCoachMemoryRequest
): Promise<CoachMemoryResponse> =>
  apiCall(`/coach-profile/memories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(memory),
  });

export const deleteCoachMemory = (id: string): Promise<void> =>
  apiCall(`/coach-profile/memories/${id}`, { method: 'DELETE' });

export const validateMealSuggestion = (
  ingredients: string[]
): Promise<ValidateMealSuggestionResponse> =>
  apiCall('/coach-profile/validate-meal', {
    method: 'POST',
    body: JSON.stringify({ ingredients }),
  });
