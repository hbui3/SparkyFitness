import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getTelegramAdminConfig,
  removeTelegramAdminConfig,
  updateTelegramAdminConfig,
} from '@/api/Admin/telegramCoachService';
import { settingsKeys } from '@/api/keys/admin';
import { preferencesKeys } from '@/api/keys/settings';

export const useTelegramCoachSettings = () => {
  const { t } = useTranslation();
  return useQuery({
    queryKey: settingsKeys.telegramCoach(),
    queryFn: getTelegramAdminConfig,
    meta: {
      errorMessage: t(
        'admin.telegramCoach.loadError',
        'Failed to load Telegram coach settings.'
      ),
    },
  });
};

function useRefreshTelegramSettings() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({
      queryKey: settingsKeys.telegramCoach(),
    });
    void queryClient.invalidateQueries({
      queryKey: preferencesKeys.coachTelegram(),
    });
  };
}

export const useUpdateTelegramCoachSettings = () => {
  const { t } = useTranslation();
  const refresh = useRefreshTelegramSettings();
  return useMutation({
    mutationFn: updateTelegramAdminConfig,
    onSuccess: refresh,
    meta: {
      errorMessage: t(
        'admin.telegramCoach.saveError',
        'The bot token could not be validated or saved.'
      ),
      successMessage: t(
        'admin.telegramCoach.saveSuccess',
        'Telegram bot connected and saved securely.'
      ),
    },
  });
};

export const useRemoveTelegramCoachSettings = () => {
  const { t } = useTranslation();
  const refresh = useRefreshTelegramSettings();
  return useMutation({
    mutationFn: removeTelegramAdminConfig,
    onSuccess: refresh,
    meta: {
      errorMessage: t(
        'admin.telegramCoach.removeError',
        'Failed to remove the saved Telegram bot.'
      ),
      successMessage: t(
        'admin.telegramCoach.removeSuccess',
        'Saved Telegram bot removed.'
      ),
    },
  });
};
