import { preferencesKeys } from '@/api/keys/settings';
import {
  getHeartRateZones,
  updateHeartRateZones,
} from '@/api/Settings/heartRateZones';
import { useAuth } from '@/hooks/useAuth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  HeartRateZonesResponse,
  UpdateHeartRateZonesBody,
} from '@workspace/shared';
import { useTranslation } from 'react-i18next';

export const useHeartRateZones = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  return useQuery({
    queryKey: preferencesKeys.heartRateZones(),
    queryFn: getHeartRateZones,
    enabled: !!user,
    meta: {
      errorMessage: t(
        'settings.heartRateZones.failedToLoad',
        'Failed to load heart rate zones.'
      ),
    },
  });
};

export const useUpdateHeartRateZonesMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (body: UpdateHeartRateZonesBody) => updateHeartRateZones(body),
    onSuccess: (data: HeartRateZonesResponse) => {
      queryClient.setQueryData(preferencesKeys.heartRateZones(), data);
    },
    meta: {
      errorMessage: t(
        'settings.heartRateZones.failedToSave',
        'Failed to save heart rate zones. Check the values and try again.'
      ),
      successMessage: t(
        'settings.heartRateZones.saved',
        'Heart rate zones saved.'
      ),
    },
  });
};
