import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ChevronDown } from 'lucide-react';
import {
  WORKOUT_FEEDBACK_DIFFICULTIES,
  WORKOUT_FEEDBACK_PAIN_NOTE_MAX_LENGTH,
  type WorkoutFeedbackDifficulty,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useWorkoutSessionFeedback } from '@/hooks/Exercises/useWorkoutCoaching';

interface FeedbackExercise {
  /** Exercise entry id. */
  id: string;
  name: string;
}

interface WorkoutFeedbackPanelProps {
  presetEntryId: string;
  exercises: FeedbackExercise[];
}

function difficultyLabel(
  t: TFunction,
  difficulty: WorkoutFeedbackDifficulty
): string {
  switch (difficulty) {
    case 'too_easy':
      return t('workoutFeedback.difficulty.tooEasy', 'Too easy');
    case 'just_right':
      return t('workoutFeedback.difficulty.justRight', 'Just right');
    case 'too_hard':
      return t('workoutFeedback.difficulty.tooHard', 'Too hard');
  }
}

/**
 * "How did it feel?" — end-of-workout feedback that adaptive suggestions
 * learn from (issue #1560). Every answer autosaves.
 */
const WorkoutFeedbackPanel = ({
  presetEntryId,
  exercises,
}: WorkoutFeedbackPanelProps) => {
  const { t } = useTranslation();
  const { draft, update, retry, saveState, isLoading, isError, reload } =
    useWorkoutSessionFeedback(presetEntryId);
  const [showPerExercise, setShowPerExercise] = useState(false);

  if (isLoading) return null;
  // Every save replaces the whole session's feedback, so answering from an
  // empty form after a failed load would erase what is already saved.
  if (isError) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        {t('workoutFeedback.loadFailed', "Couldn't load your feedback.")}{' '}
        <Button
          type="button"
          variant="link"
          className="h-auto p-0"
          onClick={() => void reload()}
        >
          {t('workoutFeedback.tryAgain', 'Try again')}
        </Button>
      </div>
    );
  }

  const toggle = <T,>(current: T | null, value: T): T | null =>
    current === value ? null : value;

  return (
    <div className="space-y-3 rounded-lg border p-4 text-left">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">
          {t('workoutFeedback.title', 'How did it feel?')}
        </h3>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {saveState === 'saving'
            ? t('workoutFeedback.saving', 'Saving…')
            : saveState === 'saved'
              ? t('workoutFeedback.saved', 'Saved')
              : ''}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('workoutFeedback.subtitle', 'Your next suggestions adjust to this.')}
      </p>

      <div className="grid grid-cols-3 gap-2" role="group">
        {WORKOUT_FEEDBACK_DIFFICULTIES.map((difficulty) => (
          <Button
            key={difficulty}
            type="button"
            size="sm"
            variant={draft.difficulty === difficulty ? 'default' : 'outline'}
            aria-pressed={draft.difficulty === difficulty}
            onClick={() =>
              update((current) => ({
                ...current,
                difficulty: toggle(current.difficulty, difficulty),
              }))
            }
          >
            {difficultyLabel(t, difficulty)}
          </Button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`pain-${presetEntryId}`}>
          {t('workoutFeedback.painQuestion', 'Any pain or discomfort?')}
        </Label>
        <Switch
          id={`pain-${presetEntryId}`}
          checked={draft.pain}
          onCheckedChange={(pain) =>
            update((current) => ({ ...current, pain }))
          }
        />
      </div>

      {draft.pain && (
        <div className="space-y-2">
          {exercises.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                {t(
                  'workoutFeedback.painWhere',
                  'During which exercises? (optional)'
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {exercises.map((exercise) => {
                  const selected = draft.painExerciseEntryIds.includes(
                    exercise.id
                  );
                  return (
                    <Button
                      key={exercise.id}
                      type="button"
                      size="sm"
                      variant={selected ? 'default' : 'outline'}
                      aria-pressed={selected}
                      onClick={() =>
                        update((current) => ({
                          ...current,
                          painExerciseEntryIds: selected
                            ? current.painExerciseEntryIds.filter(
                                (id) => id !== exercise.id
                              )
                            : [...current.painExerciseEntryIds, exercise.id],
                        }))
                      }
                    >
                      {exercise.name}
                    </Button>
                  );
                })}
              </div>
            </>
          )}
          <Textarea
            value={draft.painNote}
            maxLength={WORKOUT_FEEDBACK_PAIN_NOTE_MAX_LENGTH}
            placeholder={t(
              'workoutFeedback.painNotePlaceholder',
              'What hurt? (optional)'
            )}
            aria-label={t(
              'workoutFeedback.painNotePlaceholder',
              'What hurt? (optional)'
            )}
            onChange={(event) => {
              const painNote = event.target.value;
              update((current) => ({ ...current, painNote }), {
                debounce: true,
              });
            }}
          />
          <p className="text-xs text-muted-foreground">
            {t(
              'workoutFeedback.painPrivacy',
              'Suggestions for these exercises get lighter, never heavier.'
            )}
          </p>
        </div>
      )}

      {exercises.length > 0 && (
        <button
          type="button"
          className="flex w-full items-center justify-between text-sm font-medium text-primary"
          aria-expanded={showPerExercise}
          onClick={() => setShowPerExercise((value) => !value)}
        >
          {t('workoutFeedback.rateExercises', 'Rate each exercise')}
          <ChevronDown
            className={`h-4 w-4 transition-transform ${
              showPerExercise ? 'rotate-180' : ''
            }`}
          />
        </button>
      )}

      {showPerExercise && (
        <div className="space-y-3">
          {exercises.map((exercise) => {
            const current = draft.exerciseDifficulty[exercise.id] ?? null;
            return (
              <div key={exercise.id} className="space-y-1">
                <div className="truncate text-sm">{exercise.name}</div>
                <div className="flex flex-wrap gap-1" role="group">
                  {WORKOUT_FEEDBACK_DIFFICULTIES.map((difficulty) => (
                    <Button
                      key={difficulty}
                      type="button"
                      size="sm"
                      variant={current === difficulty ? 'default' : 'outline'}
                      aria-pressed={current === difficulty}
                      aria-label={`${exercise.name}: ${difficultyLabel(t, difficulty)}`}
                      onClick={() =>
                        update((value) => ({
                          ...value,
                          exerciseDifficulty: {
                            ...value.exerciseDifficulty,
                            [exercise.id]: toggle(current, difficulty),
                          },
                        }))
                      }
                    >
                      {difficultyLabel(t, difficulty)}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {saveState === 'error' && (
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-destructive"
          onClick={() => void retry()}
        >
          {t(
            'workoutFeedback.saveFailed',
            "Couldn't save your feedback. Try again."
          )}
        </Button>
      )}
    </div>
  );
};

export default WorkoutFeedbackPanel;
