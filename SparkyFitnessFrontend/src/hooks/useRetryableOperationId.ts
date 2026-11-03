import { useCallback, useRef } from 'react';
import { generateClientId } from '@/utils/generateClientId';

/** Keep a failed request safe to retry when its response may have been lost. */
export function useRetryableOperationId() {
  const pending = useRef(new Map<string, string>());

  const getOperationId = useCallback((requestKey: string): string => {
    const existing = pending.current.get(requestKey);
    if (existing) return existing;

    const operationId = generateClientId();
    pending.current.set(requestKey, operationId);
    return operationId;
  }, []);

  const completeOperation = useCallback((operationId: string): void => {
    for (const [requestKey, pendingOperationId] of pending.current) {
      if (pendingOperationId === operationId) {
        pending.current.delete(requestKey);
        break;
      }
    }
  }, []);

  return { getOperationId, completeOperation };
}
