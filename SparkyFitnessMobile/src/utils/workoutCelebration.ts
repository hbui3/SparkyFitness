import type { ActiveWorkoutState } from '../stores/activeWorkoutStore';
import type { RootStackParamList } from '../types/navigation';

export type WorkoutCelebration = RootStackParamList['WorkoutComplete'];

/**
 * Snapshots the live workout into `WorkoutComplete`'s params, or null when
 * there is nothing worth celebrating (no completed sets on a standard
 * workout). Must be read BEFORE `clearWorkout()` — the completion screen
 * mounts after the store is empty.
 *
 * Shared by the phone's own Finish (`useActiveWorkoutFinish`) and a finish on
 * the paired watch (`useWatchWorkoutBridge`), so both end on the same screen.
 */
export function buildWorkoutCelebration(
  state: ActiveWorkoutState,
  finishedAt: number = Date.now()
): WorkoutCelebration | null {
  if (state.session == null) return null;
  const isIntervalWorkout = state.workoutFormat !== 'standard';
  const hasCompletedSets = Object.keys(state.completedSetIds).length > 0;
  if (!hasCompletedSets && !isIntervalWorkout) return null;
  return {
    session: state.session,
    completedSetIds: state.completedSetIds,
    prSetIds: state.prSetIds,
    startedAt: state.startedAt,
    finishedAt,
    sourcePresetId: state.sourcePresetId,
    sourceServerConfigId: state.sourceServerConfigId,
    plannedSetValues: state.plannedSetValues,
    previousSessionSets: state.previousSessionSets,
    exerciseConfigs: state.exerciseConfigs,
    weightUnit: state.weightUnit,
    workoutFormat: state.workoutFormat,
    timeCapSeconds: state.timeCapSeconds,
    intervalRoundsCompleted: state.intervalRoundsCompleted,
    intervalRepsCompleted: state.intervalRepsCompleted,
    intervalStatus: state.intervalStatus,
    intervalScalingNotes: state.intervalScalingNotes,
  };
}
