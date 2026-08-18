import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { UpdateCoachProfileRequest } from '@workspace/shared';
import { preferencesKeys } from '@/api/keys/settings';
import {
  getCoachProfile,
  updateCoachProfile,
} from '@/api/Settings/coachProfile';
import { useAuth } from '@/hooks/useAuth';

export const useCoachProfile = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  return useQuery({
    queryKey: preferencesKeys.coachProfile(),
    queryFn: getCoachProfile,
    enabled: !!user,
    meta: {
      errorMessage: t(
        'settings.coachProfile.loadError',
        'Failed to load coach profile.'
      ),
    },
  });
};

export const useUpdateCoachProfile = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (profile: UpdateCoachProfileRequest) =>
      updateCoachProfile(profile),
    onSuccess: (profile) => {
      queryClient.setQueryData(preferencesKeys.coachProfile(), profile);
    },
    meta: {
      errorMessage: t(
        'settings.coachProfile.saveError',
        'Failed to save coach profile.'
      ),
      successMessage: t(
        'settings.coachProfile.saveSuccess',
        'Coach profile saved.'
      ),
    },
  });
};
