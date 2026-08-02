import { useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { ERP_DATA_MUTATED_EVENT, isLiveQuery, LIVE_POLL_MS } from '../../config/realtime';
import { subscribeRealtimeEvents } from '../../lib/realtimeStream';

/** Keeps dashboards, stats, and lists in sync without manual refresh. */
export function RealtimeSync() {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const refreshLive = useCallback(() => {
    queryClient.invalidateQueries({
      predicate: (query) => isLiveQuery(query.queryKey),
    });
  }, [queryClient]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const onVisible = () => {
      if (!document.hidden) refreshLive();
    };

    const onMutated = () => refreshLive();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refreshLive);
    window.addEventListener('focus', refreshLive);
    window.addEventListener(ERP_DATA_MUTATED_EVENT, onMutated);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refreshLive);
      window.removeEventListener('focus', refreshLive);
      window.removeEventListener(ERP_DATA_MUTATED_EVENT, onMutated);
    };
  }, [isAuthenticated, refreshLive]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const pollId = window.setInterval(() => {
      if (!document.hidden) refreshLive();
    }, LIVE_POLL_MS);

    return () => window.clearInterval(pollId);
  }, [isAuthenticated, refreshLive]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const controller = new AbortController();
    let retryMs = 3000;
    let retryTimer: number | undefined;

    const connect = async () => {
      try {
        await subscribeRealtimeEvents(controller.signal, (event) => {
          if (event.type === 'tick' || event.type === 'connected') {
            refreshLive();
          }
        });
        // Stream closed cleanly (proxy idle / HTTP/2 ping) — reconnect soon
        if (!controller.signal.aborted) {
          retryMs = 2000;
          retryTimer = window.setTimeout(connect, retryMs);
        }
      } catch {
        // Polling in this component already keeps data fresh; SSE is best-effort.
        if (!controller.signal.aborted) {
          retryTimer = window.setTimeout(connect, retryMs);
          retryMs = Math.min(retryMs * 2, 60_000);
        }
      }
    };

    connect();

    return () => {
      controller.abort();
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [isAuthenticated, refreshLive]);

  return null;
}
