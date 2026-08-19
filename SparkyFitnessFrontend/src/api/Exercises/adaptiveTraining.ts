import { apiCall } from '@/api/api';
import type {
  AdaptiveTrainingDashboardResponse,
  AdaptiveTrainingRecommendation,
  AdaptiveTrainingSettingsResponse,
  UpdateAdaptiveTrainingRecommendationStatusRequest,
} from '@workspace/shared';

export function getAdaptiveTrainingDashboard(
  date?: string
): Promise<AdaptiveTrainingDashboardResponse> {
  return apiCall('/adaptive-training/today', {
    method: 'GET',
    params: date ? { date } : undefined,
  });
}

export function updateAdaptiveTrainingSettings(
  settings: AdaptiveTrainingSettingsResponse,
  date?: string
): Promise<AdaptiveTrainingDashboardResponse> {
  return apiCall('/adaptive-training/settings', {
    method: 'PUT',
    params: date ? { date } : undefined,
    body: JSON.stringify(settings),
  });
}

export function regenerateAdaptiveTraining(
  date?: string
): Promise<AdaptiveTrainingDashboardResponse> {
  return apiCall('/adaptive-training/regenerate', {
    method: 'POST',
    body: JSON.stringify(date ? { date } : {}),
  });
}

export function updateAdaptiveTrainingRecommendationStatus(
  date: string,
  status: UpdateAdaptiveTrainingRecommendationStatusRequest['status']
): Promise<AdaptiveTrainingRecommendation> {
  return apiCall(`/adaptive-training/recommendations/${date}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}
