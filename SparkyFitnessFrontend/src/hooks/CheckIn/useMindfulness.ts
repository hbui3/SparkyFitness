import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchMindfulnessDaySummary,
  createMindfulnessSession,
  updateMindfulnessSession,
  deleteMindfulnessSession,
} from '@/api/CheckIn/mindfulnessService';
import { mindfulnessKeys } from '@/api/keys/checkin';
import type {
  CreateMindfulnessSessionBody,
  UpdateMindfulnessSessionBody,
} from '@workspace/shared';

export const useMindfulnessDaySummary = (date: string) => {
  return useQuery({
    queryKey: mindfulnessKeys.daySummary(date),
    queryFn: () => fetchMindfulnessDaySummary(date),
    enabled: Boolean(date),
  });
};

export const useCreateMindfulnessSessionMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMindfulnessSessionBody) =>
      createMindfulnessSession(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mindfulnessKeys.all });
    },
  });
};

export const useUpdateMindfulnessSessionMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: UpdateMindfulnessSessionBody;
    }) => updateMindfulnessSession(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mindfulnessKeys.all });
    },
  });
};

export const useDeleteMindfulnessSessionMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteMindfulnessSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mindfulnessKeys.all });
    },
  });
};
