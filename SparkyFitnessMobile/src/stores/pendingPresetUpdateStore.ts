import { create } from 'zustand';
import type { WorkoutCelebration } from '../utils/workoutCelebration';

/**
 * A workout the wearer finished on the watch while the phone was somewhere
 * other than the Active Workout screen. It never reached the completion
 * screen, so its "Update preset?" check waits here until the app shows the
 * prompt. Kept in memory only: it is a one-time question, not data.
 */
export interface PendingPresetUpdate {
  celebration: WorkoutCelebration;
  /** The watch's id for the workout, to match its answer. */
  sessionId: string;
}

interface PendingPresetUpdateState {
  pending: PendingPresetUpdate | null;
  /** Finishes that arrived while a prompt was already waiting. */
  pendingQueue: PendingPresetUpdate[];
  /**
   * What the wearer answered on the watch's "Update Workout?" question, by the
   * watch's workout id. It is asked when Finish is tapped, so it can arrive
   * before or after the finished workout does.
   */
  answers: Record<string, boolean>;
  setPending: (pending: PendingPresetUpdate) => void;
  clearPending: () => void;
  setAnswer: (sessionId: string, update: boolean) => void;
  clearAnswer: (sessionId: string) => void;
}

export const usePendingPresetUpdateStore = create<PendingPresetUpdateState>(
  (set) => ({
    pending: null,
    pendingQueue: [],
    answers: {},
    setPending: (pending) =>
      set((state) =>
        state.pending == null
          ? { pending }
          : { pendingQueue: [...state.pendingQueue, pending] }
      ),
    clearPending: () =>
      set((state) => ({
        pending: state.pendingQueue[0] ?? null,
        pendingQueue: state.pendingQueue.slice(1),
      })),
    setAnswer: (sessionId, update) =>
      set((state) => ({ answers: { ...state.answers, [sessionId]: update } })),
    clearAnswer: (sessionId) =>
      set((state) => {
        const { [sessionId]: _removed, ...rest } = state.answers;
        return { answers: rest };
      }),
  })
);
