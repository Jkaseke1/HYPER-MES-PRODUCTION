import { canRefreshInBackground, startBackgroundPolling } from './backendAvailability';

export const refreshIntervals = {
  operational: 60000,
  reports: 120000,
  posting: 30000,
} as const;

/** Bounds timer, focus, and Realtime-driven automatic reads to one request per interval. */
export function startBackgroundRefresh(refresh: () => void | PromiseLike<unknown>, intervalMs: number) {
  let stopped = false;
  let running = false;
  let nextReadAt = Date.now() + intervalMs;
  const request = async () => {
    if (stopped || running || !canRefreshInBackground() || Date.now() < nextReadAt) return;
    running = true;
    nextReadAt = Date.now() + intervalMs;
    try {
      await refresh();
    } catch (error) {
      console.warn('Automatic refresh failed:', error);
    } finally {
      running = false;
    }
  };
  const stopPolling = startBackgroundPolling(request, intervalMs);
  const onActive = () => { void request(); };
  document.addEventListener('visibilitychange', onActive);
  window.addEventListener('online', onActive);
  return {
    request,
    stop() {
      stopped = true;
      stopPolling();
      document.removeEventListener('visibilitychange', onActive);
      window.removeEventListener('online', onActive);
    },
  };
}
