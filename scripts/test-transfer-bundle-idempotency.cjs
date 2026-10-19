const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
vm.runInNewContext(compile(fs.readFileSync('src/lib/transferRequestIdentity.ts', 'utf8')), { exports: exportsObject });
vm.runInNewContext(compile(fs.readFileSync('src/lib/transferDocumentDate.ts', 'utf8')), { exports: exportsObject });
for (const value of ['', '2026-02-29', '2026-13-01', '03/10/2026', '2026-10-03T12:00:00Z']) {
  assert.equal(exportsObject.isValidTransferDocumentDate(value), false, value);
}
for (const value of ['2026-10-03', '2028-02-29']) {
  assert.equal(exportsObject.isValidTransferDocumentDate(value), true, value);
}
let keyCount = 0;
const key = () => 'key-' + (++keyCount);
const original = exportsObject.transferRequestIdentity(null, { quantity: 10 }, key);
assert.equal(exportsObject.transferRequestIdentity(original, { quantity: 10 }, key), original);
assert.notEqual(exportsObject.transferRequestIdentity(original, { quantity: 11 }, key).key, original.key);

const page = fs.readFileSync('src/pages/MaterialTransferPage.tsx', 'utf8');
const source = page.slice(page.indexOf('  async function createTransfers()'), page.indexOf('  const transferSearch'));
const keys = [];
const errors = [];
let loseResponse = true;
let creations = 0;
let authCalls = 0;
let resetForm;
const stored = new Map();
const context = {
  saving: false, refreshingTransferStock: false, creatingTransfers: { current: false },
  transferSubmission: { current: null }, transferRequestIdentity: exportsObject.transferRequestIdentity,
  isValidTransferDocumentDate: exportsObject.isValidTransferDocumentDate,
  setSaving() {}, setTransferError(value) { if (value) errors.push(value); },
  warehouses: [{ id: 'rm', code: 'RM' }], transfers: [],
  transferLines: [{ raw_material_id: 'a', quantity: 10 }, { raw_material_id: 'b', quantity: 20 }],
  rawMaterials: [{ id: 'a', unit: 'kg' }, { id: 'b', unit: 'kg' }],
  sharedForm: { transfer_date: '2026-10-03', purpose: 'HFIST777', notes: '', production_order_id: '' },
  requestFreshSageTransferStock: async () => new Map([['a', 100], ['b', 100]]),
  bufferWarehouseBalances: {}, crypto: { randomUUID: key }, withClientTimeout: async promise => await promise,
  console: { error() {} }, setShowCreate() {}, setTransferLines() {}, setSharedForm(value) { resetForm = value; },
  setSuccessMessage() {}, setTimeout() {}, fetchData() {}, format: () => '2026-10-19',
  supabase: {
    auth: { getUser: async () => { authCalls++; return { data: { user: { id: 'user' } } }; } },
    rpc: async (name, payload) => {
      assert.equal(name, 'create_material_transfer_bundle');
      assert.equal(payload.p_lines.length, 2);
      assert.equal(payload.p_transfer_date, '2026-10-03', 'The selected historical document date is sent unchanged');
      keys.push(payload.p_transfer_batch_key);
      if (!stored.has(payload.p_transfer_batch_key)) {
        creations++;
        stored.set(payload.p_transfer_batch_key, ['a-id', 'b-id']);
      }
      if (loseResponse) { loseResponse = false; throw Error('Network response lost'); }
      return { data: stored.get(payload.p_transfer_batch_key), error: null };
    },
  },
};
vm.createContext(context);
vm.runInContext(compile(source), context);
async function main() {
  for (const date of ['', '2026-02-30']) {
    context.sharedForm.transfer_date = date;
    await context.createTransfers();
    assert.match(errors.pop()[0], /Select a valid RM transfer date/);
    assert.equal(authCalls, 0, 'Invalid date is blocked before network requests');
    assert.equal(context.creatingTransfers.current, false, 'Validation releases the submission lock');
    assert.equal(keys.length, 0);
  }
  context.sharedForm.transfer_date = '2026-10-03';
  const first = context.createTransfers();
  const doubleClick = context.createTransfers();
  await Promise.all([first, doubleClick]);
  assert.equal(keys.length, 1, 'Synchronous click lock blocks double submission');
  assert.equal(errors.length, 1);
  await context.createTransfers();
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1], 'A lost response retains the same request key');
  assert.equal(creations, 1, 'Idempotent server response is accepted without creating a new bundle');
  assert.equal(resetForm.transfer_date, '', 'A successful save clears the next document date');
  assert.doesNotMatch(page, /transfer_date: format\(new Date/);
  assert.match(page, /setSharedForm\(previous => \(\{ \.\.\.previous, transfer_date: '' \}\)\)/);
  assert.match(page, /!isValidTransferDocumentDate\(sharedForm.transfer_date\) \|\|/);
  const sql = fs.readFileSync('supabase/migrations/20261019200000_atomic_material_transfer_creation.sql', 'utf8');
  assert.match(sql, /pg_advisory_xact_lock/g);
  assert.match(sql, /v_existing IS DISTINCT FROM v_expected/);
  assert(sql.indexOf('RETURN v_ids;') < sql.indexOf('public.create_material_transfer_to_buffer('), 'Replay returns before any allocation');
  assert.doesNotMatch(sql, /EXCEPTION WHEN/i, 'A failed line is not swallowed: the transaction must roll back');
  assert.match(sql, /count\(DISTINCT raw_material_id\)/);
  assert.doesNotMatch(source, /Retry this material; the system will generate a new reference/);
  console.log('Double-click and lost-response retry tests passed; SQL transaction/idempotency structure checked, not database-executed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
