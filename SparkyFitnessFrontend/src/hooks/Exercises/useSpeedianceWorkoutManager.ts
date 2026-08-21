import {
  deleteSpeedianceWorkout,
  getSpeedianceWorkout,
  listSpeedianceWorkouts,
  saveSpeedianceWorkout,
  searchSpeedianceExercises,
  setSpeedianceReservation,
} from '@/api/Exercises/speedianceWorkoutManager';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const speedianceWorkoutKeys = {
  all: ['speediance-workouts'] as const,
  list: (providerId?: string) =>
    [...speedianceWorkoutKeys.all, 'list', providerId ?? 'default'] as const,
  detail: (code: string, providerId?: string) =>
    [
      ...speedianceWorkoutKeys.all,
      'detail',
      code,
      providerId ?? 'default',
    ] as const,
};

export function useSpeedianceWorkouts(enabled: boolean, providerId?: string) {
  return useQuery({
    queryKey: speedianceWorkoutKeys.list(providerId),
    queryFn: () => listSpeedianceWorkouts(providerId),
    enabled,
  });
}

export function useLoadSpeedianceWorkout() {
  return useMutation({
    mutationFn: ({ code, providerId }: { code: string; providerId?: string }) =>
      getSpeedianceWorkout(code, providerId),
  });
}

export function useSearchSpeedianceExercises() {
  return useMutation({
    mutationFn: ({
      query,
      providerId,
    }: {
      query: string;
      providerId?: string;
    }) => searchSpeedianceExercises(query, providerId),
  });
}

export function useSaveSpeedianceWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveSpeedianceWorkout,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: speedianceWorkoutKeys.all });
      queryClient.invalidateQueries({ queryKey: ['workoutPresets'] });
      queryClient.setQueryData(
        speedianceWorkoutKeys.detail(result.workout.code),
        undefined
      );
    },
  });
}

export function useSetSpeedianceReservation() {
  return useMutation({
    mutationFn: ({
      code,
      date,
      scheduled,
      providerId,
    }: {
      code: string;
      date: string;
      scheduled: boolean;
      providerId?: string;
    }) => setSpeedianceReservation(code, date, scheduled, providerId),
  });
}

export function useDeleteSpeedianceWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      code,
      name,
      providerId,
    }: {
      id: string;
      code: string;
      name: string;
      providerId?: string;
    }) => deleteSpeedianceWorkout(id, code, name, providerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: speedianceWorkoutKeys.all });
    },
  });
}
