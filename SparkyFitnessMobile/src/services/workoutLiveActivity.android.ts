import { AppState, NativeModules } from 'react-native';
import i18n from '../localization/i18n';
import {
  useActiveWorkoutStore,
  type ActiveWorkoutState,
} from '../stores/activeWorkoutStore';
import { useAppPreferencesStore } from '../stores/appPreferencesStore';
import {
  describeActiveSet,
  formatElapsed,
  formatRestCountdown,
} from '../utils/workoutSession';
import { buildExerciseProgress } from '../utils/workoutProgress';
import { createConcurrencyLimiter } from '../utils/concurrency';
import { addLog } from './LogService';
import {
  buildWorkoutLiveActivityLabels,
  resolveWorkoutLiveActivityLocale,
} from './workoutLiveActivityLabels';

export interface AndroidWorkoutNotification {
  name: string;
  startedAt: number;
  phase: 'active' | 'resting' | 'paused' | 'complete';
  exerciseLine: string;
  restEndsAt: number | null;
  restText: string;
  elapsedText: string;
  progressText: string;
  setPosition: string;
  completedSets: number;
  setCounts: number[];
  channelName: string;
}

interface WorkoutNotificationNativeModule {
  show(payload: AndroidWorkoutNotification): Promise<void>;
  clear(): Promise<void>;
}

const nativeModule = NativeModules.WorkoutNotification as
  WorkoutNotificationNativeModule | undefined;

export function computeAndroidWorkoutNotification(
  state: Pick<
    ActiveWorkoutState,
    | 'sessionId'
    | 'session'
    | 'startedAt'
    | 'activeSetId'
    | 'steps'
    | 'completedSetIds'
    | 'rest'
  >
): AndroidWorkoutNotification | null {
  const {
    sessionId,
    session,
    startedAt,
    activeSetId,
    steps,
    completedSetIds,
    rest,
  } = state;
  if (sessionId == null || session == null || startedAt == null) return null;

  const labels = buildWorkoutLiveActivityLabels(
    resolveWorkoutLiveActivityLocale(i18n.resolvedLanguage)
  );
  const exercises = buildExerciseProgress(session, completedSetIds);
  const completedExercises = exercises.filter(
    (exercise) =>
      exercise.totalSets > 0 && exercise.completedSets >= exercise.totalSets
  ).length;
  const description = describeActiveSet(session, activeSetId);
  const complete = activeSetId == null && steps.length > 0;
  const phase = complete
    ? 'complete'
    : rest.state === 'resting' && rest.endsAt != null
      ? 'resting'
      : rest.state === 'paused' && rest.pausedRemainingMs != null
        ? 'paused'
        : 'active';
  const lastCompletedAt = Math.max(
    startedAt,
    ...Object.values(completedSetIds)
  );
  const activeSetIndex = steps.findIndex((step) => step.setId === activeSetId);
  const completedSets = steps.filter(
    (step) => completedSetIds[step.setId] != null
  ).length;
  const nextSet = activeSetIndex >= 0 ? activeSetIndex + 1 : completedSets + 1;

  return {
    name: session.name ?? labels.workout,
    startedAt,
    phase,
    exerciseLine: complete
      ? labels.workoutComplete
      : description == null
        ? labels.workout
        : `${description.exerciseName ?? labels.exercise} · ${labels.set} ${description.setNumber} ${labels.setOf} ${description.setCount}`,
    restEndsAt: phase === 'resting' ? rest.endsAt : null,
    restText:
      phase === 'resting'
        ? labels.rest
        : phase === 'paused'
          ? `${labels.rest} · ${labels.paused} ${formatRestCountdown(rest.pausedRemainingMs ?? 0)}`
          : '',
    elapsedText: complete
      ? `${labels.elapsed}: ${formatElapsed(startedAt, lastCompletedAt)}`
      : labels.elapsed,
    progressText: i18n.t('activeWorkout.header.exerciseProgress', {
      defaultValue: '{{completed}} / {{count}} exercises',
      completed: completedExercises,
      count: exercises.length,
    }),
    setPosition: `${Math.min(nextSet, steps.length)}/${steps.length}`,
    completedSets,
    setCounts: exercises.map((exercise) => exercise.totalSets),
    channelName: i18n.t('notifications.channels.ongoingWorkout', {
      defaultValue: 'Ongoing workout',
    }),
  };
}

let initialized = false;
let ready = false;
let unsubscribeWorkout: (() => void) | null = null;
let unsubscribePreferences: (() => void) | null = null;
let unsubscribeHydration: (() => void) | null = null;
let unsubscribeLanguage: (() => void) | null = null;
let unsubscribeAppState: (() => void) | null = null;
let enqueue = createConcurrencyLimiter(1);
let lastPayload: string | null = null;
let hasSynced = false;

function sync(): void {
  void enqueue(async () => {
    if (!nativeModule) return;
    const enabled = useAppPreferencesStore.getState().notificationsEnabled;
    const payload = enabled
      ? computeAndroidWorkoutNotification(useActiveWorkoutStore.getState())
      : null;
    if (payload == null) {
      if (!hasSynced || lastPayload != null) await nativeModule.clear();
      lastPayload = null;
      hasSynced = true;
      return;
    }
    const serialized = JSON.stringify(payload);
    if (serialized === lastPayload) return;
    await nativeModule.show(payload);
    lastPayload = serialized;
    hasSynced = true;
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    void addLog(`[WorkoutNotification] sync failed: ${message}`, 'ERROR');
  });
}

export async function initWorkoutLiveActivity(): Promise<void> {
  if (initialized) return;
  initialized = true;
  unsubscribeWorkout = useActiveWorkoutStore.subscribe((state, previous) => {
    if (!ready) return;
    if (
      state.sessionId !== previous.sessionId ||
      state.session !== previous.session ||
      state.startedAt !== previous.startedAt ||
      state.activeSetId !== previous.activeSetId ||
      state.completedSetIds !== previous.completedSetIds ||
      state.rest !== previous.rest
    ) {
      sync();
    }
  });
  unsubscribePreferences = useAppPreferencesStore.subscribe(
    (state, previous) => {
      if (
        ready &&
        state.notificationsEnabled !== previous.notificationsEnabled
      ) {
        sync();
      }
    }
  );
  const onLanguageChanged = () => {
    if (ready) sync();
  };
  i18n.on('languageChanged', onLanguageChanged);
  unsubscribeLanguage = () => i18n.off('languageChanged', onLanguageChanged);
  const appStateSubscription = AppState.addEventListener('change', (state) => {
    if (ready && state === 'active') {
      // A permission change or OS removal while away needs a fresh post.
      lastPayload = null;
      hasSynced = false;
      sync();
    }
  });
  unsubscribeAppState = () => appStateSubscription.remove();

  const persist = useActiveWorkoutStore.persist;
  if (persist.hasHydrated()) {
    ready = true;
    sync();
  } else {
    unsubscribeHydration = persist.onFinishHydration(() => {
      unsubscribeHydration?.();
      unsubscribeHydration = null;
      ready = true;
      sync();
    });
  }
}

export function __resetWorkoutLiveActivityForTests(): void {
  unsubscribeWorkout?.();
  unsubscribePreferences?.();
  unsubscribeHydration?.();
  unsubscribeLanguage?.();
  unsubscribeAppState?.();
  unsubscribeWorkout = null;
  unsubscribePreferences = null;
  unsubscribeHydration = null;
  unsubscribeLanguage = null;
  unsubscribeAppState = null;
  initialized = false;
  ready = false;
  lastPayload = null;
  hasSynced = false;
  enqueue = createConcurrencyLimiter(1);
}
