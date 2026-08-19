import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdaptiveTrainingSettingsResponse,
  UpdateAdaptiveTrainingRecommendationStatusRequest,
} from '@workspace/shared';
import {
  getAdaptiveTrainingDashboard,
  regenerateAdaptiveTraining,
  updateAdaptiveTrainingRecommendationStatus,
  updateAdaptiveTrainingSettings,
} from '@/api/Exercises/adaptiveTraining';
import { adaptiveTrainingKeys } from '@/api/keys/exercises';
import { getWorkoutPresetById } from '@/api/Exercises/workoutPresets';

export function useAdaptiveTrainingDashboard(userId?: string, date?: string) {
  return useQuery({
    queryKey: adaptiveTrainingKeys.dashboard(userId, date),
    queryFn: () => getAdaptiveTrainingDashboard(date),
    enabled: Boolean(userId),
  });
}

export function useUpdateAdaptiveTrainingSettings(
  userId?: string,
  date?: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: AdaptiveTrainingSettingsResponse) =>
      updateAdaptiveTrainingSettings(settings, date),
    onSuccess: (dashboard) => {
      queryClient.setQueryData(
        adaptiveTrainingKeys.dashboard(userId, date),
        dashboard
      );
    },
  });
}

export function useRegenerateAdaptiveTraining(userId?: string, date?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => regenerateAdaptiveTraining(date),
    onSuccess: (dashboard) => {
      queryClient.setQueryData(
        adaptiveTrainingKeys.dashboard(userId, date),
        dashboard
      );
    },
  });
}

export function useUpdateAdaptiveTrainingStatus(
  userId?: string,
  date?: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      status: UpdateAdaptiveTrainingRecommendationStatusRequest['status']
    ) => {
      if (!date) throw new Error('Recommendation date is required.');
      return updateAdaptiveTrainingRecommendationStatus(date, status);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: adaptiveTrainingKeys.dashboard(userId, date),
      });
    },
  });
}

export function useAdaptiveTrainingWorkoutPreset() {
  return useMutation({
    mutationFn: (presetId: number) => getWorkoutPresetById(String(presetId)),
  });
}
