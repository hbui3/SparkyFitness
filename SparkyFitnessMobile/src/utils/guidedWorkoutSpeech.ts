import type { TFunction } from 'i18next';
import type { GuidedCue } from '@workspace/shared';

/**
 * Renders a shared guided-workout cue as the sentence to speak, in the app
 * language. Instruction lines are library content and are spoken verbatim.
 */
export function renderGuidedCue(cue: GuidedCue, t: TFunction): string {
  switch (cue.type) {
    case 'getReady':
      return t('guidedWorkout.cue.getReady', {
        defaultValue: 'Get ready. Starting {{name}}.',
        name: cue.exerciseName,
      });
    case 'setStart':
      if (cue.target.kind === 'reps') {
        return t('guidedWorkout.cue.setStartReps', {
          defaultValue: '{{name}}. {{count}} reps.',
          name: cue.exerciseName,
          count: cue.target.reps,
        });
      }
      if (cue.target.kind === 'time') {
        return t('guidedWorkout.cue.setStartSeconds', {
          defaultValue: '{{name}}. {{count}} seconds.',
          name: cue.exerciseName,
          count: cue.target.seconds,
        });
      }
      return t('guidedWorkout.cue.setStartOpen', {
        defaultValue: '{{name}}.',
        name: cue.exerciseName,
      });
    case 'instruction':
      return cue.text;
    case 'halfway':
      return t('guidedWorkout.cue.halfway', { defaultValue: 'Halfway.' });
    case 'rest':
      return t('guidedWorkout.cue.rest', {
        defaultValue: 'Rest. {{count}} seconds.',
        count: cue.seconds,
      });
    case 'intervalRest':
      return t('guidedWorkout.cue.intervalRest', { defaultValue: 'Rest.' });
    case 'nextUp':
      return t('guidedWorkout.cue.nextUp', {
        defaultValue: 'Next: {{name}}.',
        name: cue.exerciseName,
      });
    case 'workoutComplete':
      return t('guidedWorkout.cue.workoutComplete', {
        defaultValue: 'Workout complete.',
      });
  }
}

export function renderGuidedCues(
  cues: readonly GuidedCue[],
  t: TFunction
): string[] {
  return cues.map((cue) => renderGuidedCue(cue, t));
}
