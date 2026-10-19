const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const out = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/transferStockValidation.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: out });
const validate = out.verifiedTransferBalances;
assert.equal(validate(['a'], [{ raw_material_id: 'a', quantity: '12.5', is_fresh: true }], 'RM').get('a'), 12.5);
assert.equal(validate(['a'], [{ raw_material_id: 'a', quantity: 0, is_fresh: true }], 'PD').get('a'), 0);
for (const rows of [[], [{ raw_material_id: 'a', quantity: 12, is_fresh: false }],
  [{ raw_material_id: 'a', quantity: null, is_fresh: true }],
  [{ raw_material_id: 'a', quantity: 'bad', is_fresh: true }]]) {
  assert.throws(() => validate(['a'], rows, 'RM'));
}
assert.throws(() => validate(['a', 'b'], [{ raw_material_id: 'a', quantity: 12, is_fresh: true }], 'RM'));
const records = Array.from({ length: 1200 }, (_, i) => ({ id: String(i), code: 'MAT' + i, sage_code: null, is_active: true }));
function query(table) {
  let rows = table === 'raw_materials' ? records : [];
  const q = {
    select() { return q; }, order() { return q; },
    eq(key, value) { rows = rows.filter(row => row[key] === value); return q; },
    in(key, values) { rows = rows.filter(row => values.includes(row[key])); return q; },
    range(a, b) { rows = rows.slice(a, b + 1); return q; },
    then(resolve, reject) { return Promise.resolve({ data: rows.slice(0, 1000), error: null }).then(resolve, reject); },
  };
  return q;
}
const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync('bridge/sageStockSync.js', 'utf8') +
  '\nmodule.exports.test = { loadMaterials, validatedStockQuantity };', {
  module: mod, process: { env: {} }, URL, console,
  require: name => name === './lib/db' ? { supabase: { from: query } } : { sdkJson() { throw Error('No SDK calls in tests'); } },
});
async function main() {
  const result = await mod.exports.test.loadMaterials(['MAT1199']);
  assert.equal(result.length, 1, 'Targeted refresh finds materials beyond first 1000 catalogue rows');
  assert.equal(result[0].id, '1199');
  for (const value of [null, undefined, '', NaN, Infinity, 'bad']) {
    assert.throws(() => mod.exports.test.validatedStockQuantity(value));
  }
  assert.equal(mod.exports.test.validatedStockQuantity(0), 0);
  const worker = fs.readFileSync('bridge/bridgeWorker.js', 'utf8');
  const start = worker.indexOf('async function refreshRequestedSageStock(');
  const handler = worker.slice(start, worker.indexOf('async function createStockTakeSageSnapshot(', start));
  let stockResult = { failures: [], materialCount: 0, synced: 0 };
  const context = { queueSageStockSync: async () => stockResult };
  vm.createContext(context);
  vm.runInContext(handler, context);
  const event = { details: { itemCodes: ['MAT1199'], warehouseCodes: ['RM'] } };
  await assert.rejects(context.refreshRequestedSageStock(event), /Incomplete Sage stock refresh/);
  stockResult = { failures: ['SDK unavailable'], materialCount: 1, synced: 0 };
  await assert.rejects(context.refreshRequestedSageStock(event), /SDK unavailable/);
  stockResult = { failures: [], materialCount: 1, synced: 1 };
  assert.match((await context.refreshRequestedSageStock(event)).message, /refreshed/);
  const page = fs.readFileSync('src/pages/MaterialTransferPage.tsx', 'utf8');
  assert.match(page, /pendingStockChecks.current\[key\]/);
  assert.match(page, /120_000/);
  assert.doesNotMatch(page, /currentAt.getTime\(\) - syncedAt.getTime\(\)/);
  assert.match(page, /verifiedTransferBalances\(ids, rows/);
  const verifyStart = page.indexOf('  async function verifySageStock(');
  const verifySource = page.slice(verifyStart, page.indexOf('  async function requestFreshSageTransferStock(', verifyStart));
  let requestCalls = 0;
  let ticks = 0;
  let status = 'pending';
  const pending = { current: {} };
  const uiContext = {
    pendingStockChecks: pending, setStockCheckStatus() {}, fetchData() {}, verifiedTransferBalances: validate,
    Date: { now: () => ticks }, window: { setTimeout: callback => { ticks += 60000; callback(); } },
    withClientTimeout: async request => await request,
    supabase: {
      rpc: async name => name === 'read_material_transfer_stock'
        ? { data: [{ raw_material_id: 'a', quantity: 50, is_fresh: true }] }
        : (requestCalls++, { data: 'read-only-request' }),
      from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { status } }) }),
    },
  };
  vm.createContext(uiContext);
  vm.runInContext(ts.transpileModule(verifySource, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, uiContext);
  await assert.rejects(uiContext.verifySageStock(['a'], 18), /same request/);
  assert.equal(requestCalls, 1);
  assert.equal(pending.current['RM:a'], 'read-only-request');
  status = 'success';
  assert.equal((await uiContext.verifySageStock(['a'], 18)).get('a'), 50);
  assert.equal(requestCalls, 1, 'Timeout retry rechecks the existing read-only job');
  assert.equal(pending.current['RM:a'], undefined);
  console.log('Stock preflight tests passed: complete coverage, server freshness, invalid quantities, >1000-row catalogue, and false success protection.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
