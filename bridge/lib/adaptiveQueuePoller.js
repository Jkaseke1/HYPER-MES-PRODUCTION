// Queue polling backs off while idle or when Supabase is unavailable. Posting is unchanged.
function startAdaptiveQueuePolling(readQueue, { intervalMs = 15000, log = console.warn } = {}) {
  const activeInterval = Math.max(15000, intervalMs);
  let idleReads = 0;
  let failures = 0;
  let stopped = false;
  let timer;

  const tick = async () => {
    let delay = activeInterval;
    try {
      const result = await readQueue();
      if (result?.readFailed) throw new Error('Queue database unavailable');
      failures = 0;
      idleReads = result?.idle ? idleReads + 1 : 0;
      delay = idleReads
        ? Math.max(activeInterval, Math.min(60000, activeInterval * 2 ** Math.min(idleReads, 3)))
        : activeInterval;
    } catch (error) {
      failures += 1;
      delay = Math.max(activeInterval, Math.min(300000, 30000 * 2 ** Math.min(failures - 1, 4)));
      log(`Queue read paused for ${delay / 1000}s: ${error.message}`);
    } finally {
      if (!stopped) timer = setTimeout(tick, delay);
    }
  };

  void tick();
  return () => { stopped = true; clearTimeout(timer); };
}

module.exports = { startAdaptiveQueuePolling };
