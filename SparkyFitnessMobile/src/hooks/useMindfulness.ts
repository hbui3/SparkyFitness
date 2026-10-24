import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchMindfulnessDaySummary,
  createMindfulnessSession,
  updateMindfulnessSession,
  deleteMindfulnessSession,
} from '../services/api/mindfulnessApi';
import { useRefetchOnFocus } from './useRefetchOnFocus';
import type {
  CreateMindfulnessSessionBody,
  UpdateMindfulnessSessionBody,
} from '@workspace/shared';

export const mindfulnessDayQueryKey = (date: string, userId?: string) =>
  ['mindfulness', 'day', date, userId ?? 'me'] as const;

export function useMindfulnessDay(date: string, userId?: string) {
  const query = useQuery({
    queryKey: mindfulnessDayQueryKey(date, userId),
    queryFn: () => fetchMindfulnessDaySummary(date, userId),
    enabled: Boolean(date),
  });

  useRefetchOnFocus(query.refetch);

  return {
    daySummary: query.data,
    sessions: query.data?.sessions ?? [],
    totalMindfulMinutes: query.data?.total_mindful_minutes ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export function useMindfulnessMutations(selectedDate: string) {
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: (data: CreateMindfulnessSessionBody) =>
      createMindfulnessSession(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mindfulness'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: UpdateMindfulnessSessionBody;
    }) => updateMindfulnessSession(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mindfulness'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteMindfulnessSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mindfulness'] });
    },
  });

  return {
    saveSession: saveMutation.mutateAsync,
    updateSession: (id: string, data: UpdateMindfulnessSessionBody) =>
      updateMutation.mutateAsync({ id, data }),
    deleteSession: deleteMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
