import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

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
    const scheduleRefresh = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        timeoutId = undefined;
        void refreshRef.current();
      }, debounceMs);
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
