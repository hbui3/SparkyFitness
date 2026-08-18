import { apiCall } from '@/api/api';
import type { TelegramAdminConfigStatus } from '@workspace/shared';

export const getTelegramAdminConfig = (): Promise<TelegramAdminConfigStatus> =>
  apiCall('/admin/telegram-coach');

export const updateTelegramAdminConfig = (
  botToken: string
): Promise<TelegramAdminConfigStatus> =>
  apiCall('/admin/telegram-coach', {
    method: 'PUT',
    body: JSON.stringify({ botToken }),
  });

export const removeTelegramAdminConfig =
  (): Promise<TelegramAdminConfigStatus> =>
    apiCall('/admin/telegram-coach', { method: 'DELETE' });
