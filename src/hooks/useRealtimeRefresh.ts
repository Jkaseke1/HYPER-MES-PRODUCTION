import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { canRefreshInBackground } from '../lib/backendAvailability';

type RefreshCallback = () => void | Promise<void>;

/** Refreshes a page when one of its source tables changes, without a browser reload. */
export function useRealtimeRefresh(
  channelName: string,
  tables: string[],
  refresh: RefreshCallback,
  debounceMs = 450,
) {
  const refreshRef = useRef(refresh);
  const tableKey = tables.join('|');

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    let timeoutId: number | undefined;
    let refreshing = false;
    let refreshQueued = false;
    let stopped = false;
    let nextReadAt = Date.now() + 60000;
    const scheduleRefresh = () => {
      if (stopped || !canRefreshInBackground()) return;
      if (refreshing) { refreshQueued = true; return; }
      if (timeoutId) return;
      timeoutId = window.setTimeout(async () => {
        timeoutId = undefined;
        if (stopped || !canRefreshInBackground()) return;
        refreshing = true;
        nextReadAt = Date.now() + 60000;
        try {
          await refreshRef.current();
        } catch (error) {
          console.warn('Live refresh failed:', error);
        } finally {
          refreshing = false;
          if (refreshQueued) {
            refreshQueued = false;
            scheduleRefresh();
          }
        }
      }, Math.max(debounceMs, nextReadAt - Date.now()));
    };

    const channel = supabase.channel(channelName);
    tables.forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleRefresh);
    });
    channel.subscribe();

    const refreshWhenVisible = () => {
      if (!document.hidden) scheduleRefresh();
    };
    const refreshWhenActive = () => scheduleRefresh();
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenActive);
    window.addEventListener('online', refreshWhenActive);
    window.addEventListener('plantcontrol:data-changed', refreshWhenActive);

    return () => {
      stopped = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenActive);
      window.removeEventListener('online', refreshWhenActive);
      window.removeEventListener('plantcontrol:data-changed', refreshWhenActive);
      supabase.removeChannel(channel);
    };
    // tableKey intentionally stabilizes the subscription against equivalent array literals.
  }, [channelName, tableKey, debounceMs]);
}
