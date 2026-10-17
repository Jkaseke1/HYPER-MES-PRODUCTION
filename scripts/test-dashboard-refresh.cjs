const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('src/pages/DashboardPage.tsx', 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('  useEffect(() => {\n    let disposed');
assert.notEqual(start, -1);
const code = ts.transpileModule(source.slice(start, source.indexOf('  const forecastMap', start)), {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;
async function test() {
  let cleanup, visibility, calls = 0, finish;
  let blocked = true;
  let removed = false;
  const timers = new Map();
  let timerId = 0;
  const callbacks = [];
  const document = {
    hidden: false,
    addEventListener: (_, fn) => { visibility = fn; },
    removeEventListener: () => { visibility = null; },
  };
  const channel = { on: (_, filter, fn) => { callbacks.push(fn); return channel; }, subscribe() {} };
  const refreshDashboard = { current: null };
  vm.runInNewContext(code, {
    useEffect: fn => { cleanup = fn(); }, document, refreshDashboard,
    access: { production: true, inventory: true },
    fetchLiveOrders: async () => {},
    fetchDashboardData: () => { calls++; return blocked ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(); },
    setLoading() {}, console,
    supabase: { channel: () => channel, removeChannel: () => { removed = true; } },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
  });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const flush = async () => { const batch = [...timers.values()]; timers.clear(); batch.forEach(fn => fn()); await tick(); };
  assert.equal(calls, 1);
  for (let i = 0; i < 100; i++) callbacks[i % callbacks.length]();
  assert.equal(timers.size, 1);
  await flush();
  assert.equal(calls, 1, 'No overlapping loads');
  blocked = false;
  finish();
  await tick();
  assert.equal(timers.size, 1, 'Retain one follow-up');
  await flush();
  assert.equal(calls, 2);
  document.hidden = true;
  callbacks[0]();
  assert.equal(timers.size, 0);
  document.hidden = false;
  visibility();
  await flush();
  assert.equal(calls, 3);
  callbacks[0]();
  refreshDashboard.current();
  await tick();
  assert.equal(calls, 4, 'Manual refresh immediate');
  assert.equal(timers.size, 0, 'Manual refresh replaces scheduled reload');
  callbacks[0]();
  cleanup();
  await flush();
  assert.equal(calls, 4, 'No reload after cleanup');
  assert.equal(removed, true);
  assert.equal(visibility, null);
  console.log('Dashboard refresh scheduling tests passed.');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
