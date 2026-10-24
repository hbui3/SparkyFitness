import { useKeepAwake } from 'expo-keep-awake';

import { useActiveWorkoutStore } from '../stores/activeWorkoutStore';
import { useAppPreferencesStore } from '../stores/appPreferencesStore';

// The wake lock is scoped to this component's lifetime: `useKeepAwake`
// releases it on unmount, so conditional mounting is the whole on/off logic.
const KeepAwakeLock: React.FC = () => {
  useKeepAwake('active-workout');
  return null;
};

/**
 * Keeps the screen on anywhere in the app while a workout is active, when the
 * Workout Settings "Keep screen awake" toggle is on — or guided mode is: its
 * narration runs on JS timers, which stop when a locked screen suspends the
 * app (there is no background-audio mode).
 */
const ActiveWorkoutKeepAwake: React.FC = () => {
  const keepAwake = useAppPreferencesStore((s) => s.workoutKeepAwakeEnabled);
  const guided = useAppPreferencesStore((s) => s.guidedWorkoutEnabled);
  const workoutActive = useActiveWorkoutStore((s) => s.sessionId !== null);
  return (keepAwake || guided) && workoutActive ? <KeepAwakeLock /> : null;
};

export default ActiveWorkoutKeepAwake;
