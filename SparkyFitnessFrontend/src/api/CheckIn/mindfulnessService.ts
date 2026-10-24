import { api } from '@/api/api';
import type {
  CreateMindfulnessSessionBody,
  MindfulnessDaySummaryResponse,
} from '@workspace/shared';

export const fetchMindfulnessDaySummary = async (
  date: string
): Promise<MindfulnessDaySummaryResponse> => {
  return api.get('/v2/mindfulness/day-summary', {
    params: { date },
  });
};

export const createMindfulnessSession = async (
  data: CreateMindfulnessSessionBody
): Promise<unknown> => {
  return api.post('/v2/mindfulness/entries', {
    body: data,
  });
};

export const updateMindfulnessSession = async (
  id: string,
  data: Partial<CreateMindfulnessSessionBody>
): Promise<unknown> => {
  return api.put(`/v2/mindfulness/entries/${id}`, {
    body: data,
  });
};

export const deleteMindfulnessSession = async (
  id: string
): Promise<{ success: boolean }> => {
  return api.delete(`/v2/mindfulness/entries/${id}`);
};
