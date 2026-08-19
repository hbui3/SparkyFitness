import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';

/**
 * Keeps visible web data in sync when Telegram or the proactive coach changes
 * the account. EventSource reconnects automatically after transient failures.
 */
export function useCoachEvents(): void {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user || typeof EventSource === 'undefined') return;
    const events = new EventSource('/api/coach-profile/events');
    events.addEventListener('coach_data_changed', () => {
      void queryClient.invalidateQueries({ refetchType: 'active' });
    });
    return () => events.close();
  }, [queryClient, user]);
}
