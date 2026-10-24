import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import WatchConnectivity from '../../modules/watch-connectivity';
import {
  useWorkoutCompletePresetSync,
  type PresetUpdateOffer,
} from '../hooks/useWorkoutCompletePresetSync';
import {
  usePendingPresetUpdateStore,
  type PendingPresetUpdate,
} from '../stores/pendingPresetUpdateStore';

/**
 * Handles "Update preset?" for a workout finished on the watch while the
 * phone was elsewhere, where the completion screen never opens. The watch
 * asks the question itself when Finish is tapped (as Hevy does) and sends the
 * answer, which is applied here once the finished workout arrives. Without an
 * answer (the watch had nothing to ask, or was out of reach) the phone's own
 * prompt covers it once the app is in front. Mount inside the navigation
 * container (the prompt waits for focus).
 */
export default function PendingPresetUpdatePrompt() {
  const pending = usePendingPresetUpdateStore((s) => s.pending);
  const clearPending = usePendingPresetUpdateStore((s) => s.clearPending);

  // Always listening, not only while a finish is pending: the answer is given
  // on the watch before the finished workout reaches the phone.
  useEffect(() => {
    if (WatchConnectivity == null) return;
    const sub = WatchConnectivity.addListener(
      'onPresetUpdateAnswer',
      (answer) => {
        usePendingPresetUpdateStore
          .getState()
          .setAnswer(answer.sessionId, answer.update);
      }
    );
    return () => sub.remove();
  }, []);

  if (pending == null) return null;
  // Keyed so a newer finish starts a fresh check rather than reusing the
  // old one's "already prompted" state.
  return (
    <PendingPrompt
      key={pending.celebration.finishedAt}
      pending={pending}
      onSettled={clearPending}
    />
  );
}

function PendingPrompt({
  pending,
  onSettled,
}: {
  pending: PendingPresetUpdate;
  onSettled: () => void;
}) {
  const { celebration, sessionId } = pending;
  const {
    session,
    sourcePresetId,
    sourceServerConfigId,
    completedSetIds,
    plannedSetValues,
    previousSessionSets,
    exerciseConfigs,
    weightUnit,
    workoutFormat,
  } = celebration;
  const assumeSources = useMemo(
    () =>
      previousSessionSets != null && exerciseConfigs != null
        ? {
            previousSessionSets,
            exerciseConfigs,
            weightUnit,
            workoutFormat,
          }
        : undefined,
    [previousSessionSets, exerciseConfigs, weightUnit, workoutFormat]
  );

  const answer = usePendingPresetUpdateStore((s) => s.answers[sessionId]);
  const clearAnswer = usePendingPresetUpdateStore((s) => s.clearAnswer);
  const [offer, setOffer] = useState<PresetUpdateOffer | null>(null);
  const handledRef = useRef(false);
  const applyingRef = useRef(false);

  const settle = useCallback(() => {
    clearAnswer(sessionId);
    onSettled();
  }, [clearAnswer, sessionId, onSettled]);

  // The wearer's answer to the question on the watch. A failed write keeps
  // the workout pending and drops the answer, so the phone can ask instead.
  useEffect(() => {
    if (answer === undefined || handledRef.current || applyingRef.current)
      return;
    if (!answer) {
      handledRef.current = true;
      settle();
      return;
    }
    if (offer == null) return;
    applyingRef.current = true;
    void (async () => {
      const ok = await offer.update();
      applyingRef.current = false;
      if (!ok) {
        clearAnswer(sessionId);
        return;
      }
      handledRef.current = true;
      settle();
    })();
  }, [answer, offer, settle, clearAnswer, sessionId]);

  const handleNeedsUpdate = useCallback((needed: PresetUpdateOffer) => {
    setOffer(needed);
  }, []);

  useWorkoutCompletePresetSync({
    session,
    sourcePresetId,
    sourceServerConfigId,
    completedSetIds,
    plannedSetValues,
    assumeSources,
    onSettled: settle,
    onNeedsUpdate: handleNeedsUpdate,
    skipPrompt: answer !== undefined,
  });
  return null;
}
