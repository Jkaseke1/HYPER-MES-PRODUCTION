const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync('src/pages/MaterialTransferPage.tsx', 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('  useEffect(() => {\n    refreshMounted.current = true;');
assert.notEqual(start, -1);
const effect = source.slice(start, source.indexOf('  const addTransferLine', start));
let cleanup;
let requests = 0;
let nextTimer = 0;
let interval;
let visibility;
const timers = new Map();
const listeners = [];
const document = {
  hidden: false,
  addEventListener: (_, handler) => { visibility = handler; },
  removeEventListener: (_, handler) => { assert.equal(handler, visibility); visibility = null; },
};
const channel = {
  on: (_, filter, handler) => { listeners.push({ filter, handler }); return channel; },
  subscribe: () => channel,
};
let removed = false;
const mounted = { current: false };
const queued = { current: false };
vm.runInNewContext(ts.transpileModule(effect, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText, {
  useEffect: (fn) => { cleanup = fn(); },
  refreshMounted: mounted,
  fetchQueued: queued,
  fetchData: () => { requests += 1; },
  document,
  supabase: { channel: () => channel, removeChannel: () => { removed = true; } },
  setTimeout: (fn) => { timers.set(++nextTimer, fn); return nextTimer; },
  clearTimeout: (id) => timers.delete(id),
  window: {
    setInterval: (fn, ms) => { interval = fn; assert.equal(ms, 30000); return 1; },
    clearInterval: () => { interval = null; },
  },
});
const flush = () => {
  const callbacks = [...timers.values()];
  timers.clear();
  callbacks.forEach((fn) => fn());
};
assert.equal(requests, 1, 'Initial load');
assert.equal(listeners.length, 6, 'Preserve live subscriptions');
for (let i = 0; i < 100; i++) listeners[i % 6].handler();
assert.equal(timers.size, 1, 'Coalesce notification bursts');
flush();
assert.equal(requests, 2);
document.hidden = true;
interval();
listeners[0].handler();
assert.equal(timers.size, 0, 'No hidden-tab automatic requests');
document.hidden = false;
visibility();
assert.equal(timers.size, 1, 'Refresh on return');
document.hidden = true;
flush();
assert.equal(requests, 2, 'Recheck visibility before running');
document.hidden = false;
interval();
flush();
assert.equal(requests, 3, 'Fallback remains active');
listeners[0].handler();
cleanup();
assert.equal(timers.size, 0);
assert.equal(mounted.current, false);
assert.equal(visibility, null);
assert.equal(interval, null);
assert.equal(removed, true);
console.log('Material transfer refresh lifecycle tests passed.');
