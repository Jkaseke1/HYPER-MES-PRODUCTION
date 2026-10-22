type FetchGuardOptions = {
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  onChange?: () => void;
};

const unavailableStatuses = new Set([429, 502, 503, 504, 522, 524]);

/** Prevents retry storms when the database or API gateway is unavailable. */
export function createFetchGuard(options: FetchGuardOptions = {}) {
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  let retryAt = 0;
  let failures = 0;
  let probing = false;

  const retryDelay = () => Math.max(0, retryAt - now());
  const unavailable = () => new Response(JSON.stringify({
    message: 'Service temporarily unavailable. Please wait before trying again and check whether the last save completed.',
  }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(Math.max(1, Math.ceil(retryDelay() / 1000))) },
  });

  const pause = (retryAfter?: string | null) => {
    failures += 1;
    const seconds = Number(retryAfter);
    const requestedDelay = retryAfter
      ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now())
      : 0;
    const delay = Math.min(300000, Math.max(
      30000 * 2 ** Math.min(failures - 1, 2),
      Number.isFinite(requestedDelay) ? requestedDelay : 0,
    ));
    retryAt = Math.max(retryAt, now() + delay);
    options.onChange?.();
  };

  const guardedFetch: typeof fetch = async (input, init) => {
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    callerSignal?.throwIfAborted();
    if (retryDelay() > 0 || probing) return unavailable();

    const isProbe = failures > 0;
    if (isProbe) probing = true;
    const controller = new AbortController();
    const abort = () => controller.abort(callerSignal?.reason);
    callerSignal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);
    try {
      const response = await request(input, { ...init, signal: controller.signal });
      if (unavailableStatuses.has(response.status)) {
        pause(response.headers.get('Retry-After'));
        void response.body?.cancel().catch(() => undefined);
        return unavailable();
      }
      if (isProbe) {
        failures = 0;
        retryAt = 0;
        options.onChange?.();
      }
      return response;
    } catch (error) {
      if (callerSignal?.aborted) throw error;
      pause();
      return unavailable();
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abort);
      if (isProbe) probing = false;
    }
  };

  return { fetch: guardedFetch, retryDelay };
}

export const backendAvailability = createFetchGuard({
  onChange: () => window.dispatchEvent(new Event('plantcontrol:backend-state')),
});

export function canRefreshInBackground() {
  return !document.hidden && navigator.onLine && backendAvailability.retryDelay() === 0;
}

/** Runs automatic reads serially and pauses them while the app is hidden or unavailable. */
export function startBackgroundPolling(refresh: () => void | PromiseLike<unknown>, intervalMs: number) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    try {
      if (canRefreshInBackground()) await refresh();
    } catch (error) {
      console.warn('Background refresh failed:', error);
    } finally {
      if (!stopped) timer = setTimeout(tick, Math.max(intervalMs, backendAvailability.retryDelay()));
    }
  };
  timer = setTimeout(tick, intervalMs);
  return () => { stopped = true; clearTimeout(timer); };
}
