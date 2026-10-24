import { useQuery } from '@tanstack/react-query';
import {
  fetchActiveAiServiceSetting,
  type ActiveAiServiceSetting,
} from '../services/api/aiSettingsApi';
import { activeAiServiceSettingQueryKey } from './queryKeys';

export function useActiveAiServiceSetting(options?: {
  enabled?: boolean;
  staleTime?: number;
  /** Surface request failures as a query error instead of `data: null`. */
  throwOnFailure?: boolean;
}) {
  const {
    enabled = true,
    staleTime = 1000 * 60 * 5,
    throwOnFailure = false,
  } = options ?? {};
  return useQuery<ActiveAiServiceSetting | null>({
    queryKey: throwOnFailure
      ? [...activeAiServiceSettingQueryKey, 'report-failure']
      : activeAiServiceSettingQueryKey,
    queryFn: () =>
      fetchActiveAiServiceSetting(
        throwOnFailure ? { throwOnFailure: true } : undefined
      ),
    // Override the global Infinity staleTime — the active setting can change
    // server-side (admin updates global config, user adds a provider in the
    // web app) without the app reloading. Callers can pass `staleTime: 0`
    // when they need the gate to refresh every time it's re-entered (e.g.
    // after a user leaves to configure AI in the web app and returns).
    staleTime,
    enabled,
  });
}
