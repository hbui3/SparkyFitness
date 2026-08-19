import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  CreateCoachMemoryRequest,
  UpdateCoachMemoryRequest,
  UpdateCoachProfileRequest,
} from '@workspace/shared';
import { preferencesKeys } from '@/api/keys/settings';
import {
  createCoachTelegramLink,
  createCoachMemory,
  deleteCoachMemory,
  disconnectCoachTelegram,
  getCoachProfile,
  getCoachTelegramStatus,
  getCoachMemories,
  updateCoachMemory,
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

export const useCoachTelegram = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  return useQuery({
    queryKey: preferencesKeys.coachTelegram(),
    queryFn: getCoachTelegramStatus,
    enabled: !!user,
    refetchInterval: (query) =>
      query.state.data?.available && !query.state.data.connected
        ? 5_000
        : false,
    meta: {
      errorMessage: t(
        'settings.coachProfile.telegramLoadError',
        'Failed to load the Telegram connection.'
      ),
    },
  });
};

export const useCreateCoachTelegramLink = () => {
  const { t } = useTranslation();
  return useMutation({
    mutationFn: createCoachTelegramLink,
    meta: {
      errorMessage: t(
        'settings.coachProfile.telegramLinkError',
        'Failed to create a Telegram connection link.'
      ),
    },
  });
};

export const useDisconnectCoachTelegram = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: disconnectCoachTelegram,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: preferencesKeys.coachTelegram(),
      });
    },
    meta: {
      errorMessage: t(
        'settings.coachProfile.telegramDisconnectError',
        'Failed to disconnect Telegram.'
      ),
      successMessage: t(
        'settings.coachProfile.telegramDisconnectSuccess',
        'Telegram disconnected.'
      ),
    },
  });
};

export const useCoachMemories = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: preferencesKeys.coachMemories(),
    queryFn: getCoachMemories,
    enabled: !!user,
  });
};

function useRefreshCoachMemories() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: preferencesKeys.coachMemories(),
    });
}

export const useCreateCoachMemory = () => {
  const refresh = useRefreshCoachMemories();
  return useMutation({
    mutationFn: (memory: CreateCoachMemoryRequest) => createCoachMemory(memory),
    onSuccess: refresh,
  });
};

export const useUpdateCoachMemory = () => {
  const refresh = useRefreshCoachMemories();
  return useMutation({
    mutationFn: ({
      id,
      memory,
    }: {
      id: string;
      memory: UpdateCoachMemoryRequest;
    }) => updateCoachMemory(id, memory),
    onSuccess: refresh,
  });
};

export const useDeleteCoachMemory = () => {
  const refresh = useRefreshCoachMemories();
  return useMutation({ mutationFn: deleteCoachMemory, onSuccess: refresh });
};
