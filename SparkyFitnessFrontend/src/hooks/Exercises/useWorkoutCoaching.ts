import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  EMPTY_WORKOUT_FEEDBACK_DRAFT,
  workoutFeedbackDraftFromResponse,
  workoutFeedbackRequestFromDraft,
  type WorkoutCoachingSettings,
  type WorkoutFeedbackDraft,
} from '@workspace/shared';
import {
  getWorkoutCoachingSettings,
  getWorkoutCoachingSignals,
  getWorkoutSessionFeedback,
  saveWorkoutCoachingSettings,
  saveWorkoutSessionFeedback,
} from '@/api/Exercises/workoutCoaching';
import { workoutCoachingKeys } from '@/api/keys/exercises';

// Typing a note should not send a request per keystroke.
const SAVE_DEBOUNCE_MS = 600;

export type FeedbackSaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Loads and autosaves one session's feedback (issue #1560). Each change
 * replaces the whole session feedback, so saves run one after another and
 * the last answer given is the one that sticks.
 */
export const useWorkoutSessionFeedback = (presetEntryId: string) => {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: workoutCoachingKeys.feedback(presetEntryId),
    queryFn: () => getWorkoutSessionFeedback(presetEntryId),
  });

  const [draft, setDraft] = useState<WorkoutFeedbackDraft>(
    EMPTY_WORKOUT_FEEDBACK_DRAFT
  );
  const [touched, setTouched] = useState(false);
  const [saveState, setSaveState] = useState<FeedbackSaveState>('idle');
  const latestRef = useRef<WorkoutFeedbackDraft>(draft);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [seededFrom, setSeededFrom] = useState<typeof data>(undefined);
  if (data !== seededFrom && !touched) {
    setSeededFrom(data);
    setDraft(workoutFeedbackDraftFromResponse(data));
  }
  useEffect(() => {
    latestRef.current = draft;
  }, [draft]);

  const flush = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const request = workoutFeedbackRequestFromDraft(latestRef.current);
    setSaveState('saving');
    chainRef.current = chainRef.current
      .then(async () => {
        const saved = await saveWorkoutSessionFeedback(presetEntryId, request);
        queryClient.setQueryData(
          workoutCoachingKeys.feedback(presetEntryId),
          saved
        );
        queryClient.invalidateQueries({
          queryKey: workoutCoachingKeys.suggestions(),
        });
        setSaveState('saved');
      })
      .catch(() => {
        // apiCall has already surfaced the error toast.
        setSaveState('error');
      });
    return chainRef.current;
  }, [presetEntryId, queryClient]);

  const update = useCallback(
    (
      next: (current: WorkoutFeedbackDraft) => WorkoutFeedbackDraft,
      options: { debounce?: boolean } = {}
    ) => {
      setTouched(true);
      const value = next(latestRef.current);
      latestRef.current = value;
      setDraft(value);
      if (timerRef.current != null) clearTimeout(timerRef.current);
      if (options.debounce) {
        timerRef.current = setTimeout(() => {
          void flush();
        }, SAVE_DEBOUNCE_MS);
      } else {
        void flush();
      }
    },
    [flush]
  );

  // Closing the panel mid-debounce still saves the last answer.
  useEffect(
    () => () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        void flush();
      }
    },
    [flush]
  );

  return {
    draft,
    update,
    retry: flush,
    saveState,
    isLoading,
    isError,
    reload: refetch,
  };
};

export const useWorkoutCoachingSettings = () => {
  const { t } = useTranslation();
  return useQuery({
    queryKey: workoutCoachingKeys.settings(),
    queryFn: getWorkoutCoachingSettings,
    meta: {
      errorMessage: t(
        'workoutCoaching.settingsLoadFailed',
        'Could not load workout coaching settings'
      ),
    },
  });
};

export const useUpdateWorkoutCoachingSettings = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: WorkoutCoachingSettings) =>
      saveWorkoutCoachingSettings(settings),
    onSuccess: (saved) => {
      queryClient.setQueryData(workoutCoachingKeys.settings(), saved);
      queryClient.invalidateQueries({
        queryKey: workoutCoachingKeys.suggestions(),
      });
    },
    meta: {
      successMessage: t('workoutCoaching.settingsSaved', 'Settings saved'),
      errorMessage: t(
        'workoutCoaching.settingsSaveFailed',
        'Could not save workout coaching settings'
      ),
    },
  });
};

/**
 * One-off signal fetch for the workout player's load pass, which runs once
 * per workout outside React Query's render cycle (like the progression
 * stats fetch it sits beside).
 */
export const fetchWorkoutCoachingSignals = getWorkoutCoachingSignals;
