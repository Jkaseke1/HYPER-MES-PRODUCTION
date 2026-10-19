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
records.unshift({ id: 'ffs-overlap', code: 'FFS0001', sage_code: '', is_active: true });
records.unshift({ id: 'pack-alias', code: 'OLD-MAT0', sage_code: 'MAT0', is_active: true });
const writes = [];
const sdkReads = [];
const sdkFailures = new Set();
function query(table) {
  let rows = table === 'raw_materials' ? records : table === 'formulations' ? [{ sage_code: 'FFS0001', status: 'active' }] : [];
  const q = {
    upsert(row) { writes.push(row); return Promise.resolve({ error: null }); },
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
  module: mod, process: { env: { SAGE_SDK_API_KEY: 'test-only' } }, URL, console,
  require: name => name === './lib/db' ? { supabase: { from: query } } : { sdkJson(url, options) {
    assert.equal(new URL(url).pathname, '/api/v1/stock', 'Only read-only stock endpoint used');
    assert.equal(options.method, undefined);
    sdkReads.push(url);
    if (sdkFailures.has(new URL(url).searchParams.get('itemCode'))) throw Error('Simulated network failure');
    return Promise.resolve({ quantity: 4500 });
  } },
});
async function main() {
  const result = await mod.exports.test.loadMaterials(['MAT1199']);
  assert.equal(result.length, 1, 'Targeted refresh finds materials beyond first 1000 catalogue rows');
  assert.equal(result[0].id, '1199');
  const overlap = await mod.exports.syncSageStock(['FFS0001'], { warehouseCodes: [' rm '] });
  assert.equal(overlap.synced, 1, 'Explicit RM check includes an ingredient with an active formulation');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].raw_material_id, 'ffs-overlap');
  assert.equal(writes[0].warehouse_id, 18);
  assert.equal(writes[0].quantity, 4500);
  assert.equal(new URL(sdkReads[0]).searchParams.get('warehouse'), 'RM');
  writes.length = 0; sdkReads.length = 0;
  for (const options of [{ warehouseCodes: ['PD'] }, {}, { warehouseCodes: ['RM', 'PD'] }]) {
    const protectedRefresh = await mod.exports.syncSageStock(['FFS0001'], options);
    assert.equal(protectedRefresh.synced, 0);
  }
  const rolling = await mod.exports.test.loadMaterials(undefined, { fullSync: true, warehouseCodes: ['RM'] });
  assert(!rolling.some(row => row.code === 'FFS0001'), 'Unrequested catalogue refresh keeps its existing exclusion');
  assert.equal(writes.length, 0, 'No raw-material write can replace the finished-good PD balance');
  assert.equal(sdkReads.length, 0);
  const nineItems = ['FFS0001', ...Array.from({ length: 8 }, (_, i) => 'MAT' + i)];
  const nine = await mod.exports.syncSageStock(nineItems, { warehouseCodes: ['RM'], materialIds: ['ffs-overlap', ...Array.from({ length: 8 }, (_, i) => String(i))] });
  assert.equal(nine.materialCount, 9);
  assert.equal(nine.synced, 9, 'All nine preflight items refresh, including FFS0001');
  assert.equal(nine.failures.length, 0);
  assert.equal(writes.length, 9);
  assert(writes.every(row => row.warehouse_id === 18));
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
  const event = { details: { itemCodes: ['MAT1199'], materialIds: ['1199'], warehouseCodes: ['RM'], requestedBy: 'test-user' } };
  await assert.rejects(context.refreshRequestedSageStock(event), /Incomplete Sage stock refresh/);
  stockResult = { failures: ['SDK unavailable'], materialCount: 1, synced: 0 };
  await assert.rejects(context.refreshRequestedSageStock(event), /SDK unavailable/);
  stockResult = { failures: [], materialCount: 1, synced: 1, syncedMaterialIds: ['1199'], syncedItemCodes: ['MAT1199'] };
  assert.match((await context.refreshRequestedSageStock(event)).message, /refreshed/);
  stockResult = { ...stockResult, syncedMaterialIds: ['wrong-id'] };
  await assert.rejects(context.refreshRequestedSageStock(event), /Missing material IDs: 1199/);
  stockResult = { ...stockResult, syncedMaterialIds: ['1199'], syncedItemCodes: ['wrong-code'] };
  await assert.rejects(context.refreshRequestedSageStock(event), /missing Sage codes: MAT1199/);
  const fourteenCodes = ['FFS0001', ...Array.from({ length: 13 }, (_, i) => 'MAT' + i)];
  const fourteenIds = ['ffs-overlap', ...Array.from({ length: 13 }, (_, i) => String(i))];
  const unscoped = await mod.exports.test.loadMaterials(fourteenCodes, { warehouseCodes: ['RM'] });
  assert.equal(unscoped.length, 15, 'Reproduce 14 codes expanding to 15 catalogue records');
  context.queueSageStockSync = (codes, reason, options) => mod.exports.syncSageStock(codes, options);
  writes.length = 0; sdkReads.length = 0;
  const fourteenEvent = { details: { itemCodes: fourteenCodes, materialIds: fourteenIds, warehouseCodes: ['RM'], requestedBy: 'test-user' } };
  const confirmed = await context.refreshRequestedSageStock(fourteenEvent);
  assert.equal(confirmed.details.synced, 14);
  assert.equal(confirmed.details.requestedBy, 'test-user', 'Retain request audit context');
  assert.equal(confirmed.details.materialIds.length, 14);
  assert.equal(writes.length, 14);
  assert(!writes.some(row => row.raw_material_id === 'pack-alias'), 'Unselected alias is not refreshed');
  assert.equal(sdkReads.length, 14);
  assert(writes.every(row => row.warehouse_id === 18));
  await assert.rejects(context.refreshRequestedSageStock({ details: {
    itemCodes: ['MAT0', 'MAT0'], materialIds: ['0', 'pack-alias'], warehouseCodes: ['RM'],
  } }), /distinct Sage item codes/);
  await assert.rejects(context.refreshRequestedSageStock({ details: {
    itemCodes: ['MAT0'], warehouseCodes: ['RM'],
  } }), /selected material IDs/);
  sdkFailures.add('MAT0');
  await assert.rejects(context.refreshRequestedSageStock(fourteenEvent), /Simulated network failure/);
  sdkFailures.clear();
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
  console.log('Stock preflight tests passed: exact 14 selected IDs despite 15 catalogue matches, FFS overlap, missing/wrong identity denial, network failure, duplicate mapping guard, freshness and timeout retry.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
