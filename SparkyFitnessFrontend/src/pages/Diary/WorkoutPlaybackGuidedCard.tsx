import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { GuidedSetTarget } from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { resolveExerciseImageSrc } from '@/utils/exercises';
import type {
  WorkoutPlaybackDraft,
  WorkoutSetPointer,
} from '@/utils/workoutPlayback';
import {
  setGuidedSpeechMuted,
  useGuidedCaption,
  useGuidedSpeechMuted,
} from '@/utils/guidedWorkoutSpeech';
import { useImageSlideshow } from '@/hooks/useImageSlideshow';
import { useWorkoutPlaybackGuided } from './useWorkoutPlaybackGuided';

interface WorkoutPlaybackGuidedCardProps {
  draft: WorkoutPlaybackDraft;
  getDraft: () => WorkoutPlaybackDraft | null;
  updateDraft: (
    updater: (current: WorkoutPlaybackDraft) => WorkoutPlaybackDraft
  ) => void;
  onCompleteSet: (pointer: WorkoutSetPointer) => void;
  onToggleRestPause: () => void;
}

/**
 * Guided mode (#1507) for standard workouts: one set at a time with the
 * exercise image (captioned with what is being said) and a DONE — NEXT button
 * for rep-based sets. Pause freezes the session; Replay reads the set and its
 * instructions again; the speaker mutes the voice for this workout while the
 * captions carry on. Sits above the normal set list, which stays editable.
 * Rendered only while the guided-workout preference is on.
 */
export default function WorkoutPlaybackGuidedCard({
  draft,
  getDraft,
  updateDraft,
  onCompleteSet,
  onToggleRestPause,
}: WorkoutPlaybackGuidedCardProps) {
  const { t } = useTranslation();
  const { phase, paused, pause, resume, replay, finish } =
    useWorkoutPlaybackGuided({
      draft,
      getDraft,
      updateDraft,
      onCompleteSet,
      onToggleRestPause,
    });
  const muted = useGuidedSpeechMuted();
  const caption = useGuidedCaption();
  const phaseSet =
    phase.kind === 'done'
      ? null
      : phase.kind === 'rest'
        ? phase.next
        : phase.set;
  const images = phaseSet?.images ?? [];
  const imageIndex = useImageSlideshow(images.length);
  const image = images[imageIndex];
  const imageSrc = image ? resolveExerciseImageSrc(image) : null;
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const isImageValid = imageSrc != null && failedImageSrc !== imageSrc;

  const describeTarget = (target: GuidedSetTarget): string | null => {
    if (target.kind === 'reps') {
      return t('guidedWorkout.card.targetReps', {
        defaultValue: '{{count}} rep',
        defaultValue_other: '{{count}} reps',
        count: target.reps,
      });
    }
    if (target.kind === 'time') {
      return t('guidedWorkout.card.targetSeconds', {
        defaultValue: '{{count}} second',
        defaultValue_other: '{{count}} seconds',
        count: target.seconds,
      });
    }
    return null;
  };

  const cardClasses =
    'bg-white dark:bg-gray-900 rounded-2xl p-4 sm:p-5 border border-gray-200 dark:border-gray-800 shadow-sm';

  if (phase.kind === 'done') {
    return (
      <div
        data-testid="guided-workout-card"
        className={`${cardClasses} flex flex-col items-center text-center gap-2`}
      >
        <CheckCircle2 className="h-7 w-7 text-emerald-600" />
        <p className="font-semibold">
          {t(
            'guidedWorkout.card.doneWeb',
            'All sets done. Finish the workout to save it.'
          )}
        </p>
      </div>
    );
  }

  const set = phaseSet;
  let label: string;
  if (phase.kind === 'getReady') {
    label = t('guidedWorkout.card.getReady', 'Get ready');
  } else if (phase.kind === 'rest') {
    label = t('guidedWorkout.card.rest', 'Rest');
  } else {
    label = t('guidedWorkout.card.setOfTotal', {
      defaultValue: 'Set {{current}} of {{total}}',
      current: phase.set.setNumber,
      total: phase.set.totalSets,
    });
  }
  if (paused) label = t('guidedWorkout.card.paused', 'Paused');

  const target = set ? describeTarget(set.target) : null;

  const captionText = caption ? (
    <p
      data-testid="guided-caption"
      aria-live="polite"
      className="text-sm sm:text-base font-medium text-white text-center"
    >
      {caption}
    </p>
  ) : null;

  const iconButtonClasses =
    'h-9 w-9 rounded-full flex items-center justify-center transition-colors';

  return (
    <div data-testid="guided-workout-card" className={cardClasses}>
      <div className="flex items-center gap-3 mb-3">
        <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-blue-50 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900 tracking-wider">
          {t('guidedWorkout.card.badge', 'GUIDED')}
        </span>
        <span className="flex-1 truncate text-sm font-medium text-gray-500 dark:text-gray-400">
          {label}
        </span>
        <button
          type="button"
          onClick={replay}
          disabled={paused}
          aria-label={t('guidedWorkout.card.replay', 'Replay instructions')}
          title={t('guidedWorkout.card.replay', 'Replay instructions')}
          className={`${iconButtonClasses} bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40`}
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setGuidedSpeechMuted(!muted)}
          aria-label={
            muted
              ? t('guidedWorkout.card.unmute', 'Unmute voice')
              : t('guidedWorkout.card.mute', 'Mute voice')
          }
          aria-pressed={muted}
          className={`${iconButtonClasses} bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 ${
            muted ? 'text-gray-400' : 'text-gray-700 dark:text-gray-200'
          }`}
        >
          {muted ? (
            <VolumeX className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          onClick={paused ? resume : pause}
          aria-label={
            paused
              ? t('guidedWorkout.card.resume', 'Resume')
              : t('guidedWorkout.card.pause', 'Pause')
          }
          className={`${iconButtonClasses} ${
            paused
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200'
          }`}
        >
          {paused ? (
            <Play className="h-4 w-4 fill-current" />
          ) : (
            <Pause className="h-4 w-4 fill-current" />
          )}
        </button>
      </div>

      {isImageValid ? (
        <div className="relative w-full aspect-[3/2] max-h-[60vh] overflow-hidden rounded-xl bg-gray-50 dark:bg-gray-800">
          <img
            src={imageSrc}
            alt={set?.exerciseName ?? ''}
            onError={() => setFailedImageSrc(imageSrc)}
            className="h-full w-full object-contain"
          />
          {captionText && (
            <div className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-2">
              {captionText}
            </div>
          )}
        </div>
      ) : (
        captionText && (
          <div className="rounded-xl bg-black/70 px-3 py-2">{captionText}</div>
        )
      )}

      {set && (
        <div className="text-center mt-3">
          {phase.kind === 'rest' && (
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              {t('guidedWorkout.card.nextUp', 'Next up')}
            </p>
          )}
          <p className="text-xl font-bold">{set.exerciseName}</p>
          {target && (
            <p className="text-base text-gray-500 dark:text-gray-400">
              {target}
            </p>
          )}
        </div>
      )}

      {phase.kind === 'reps' && (
        <Button
          type="button"
          size="lg"
          className="mt-4 w-full h-16 text-xl font-black tracking-wider"
          onClick={() => finish(phase.set.pointer)}
        >
          {t('guidedWorkout.card.doneNext', 'DONE — NEXT')}
        </Button>
      )}
    </div>
  );
}
