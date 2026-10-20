const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: name => dependencies[name] });
  return exports;
}
const intake = load('src/lib/procurementIntake.ts');
const { saveProcurementDraft: save, loadProcurementAttempt: pending } = load('src/lib/procurementDraft.ts', {
  './procurementIntake': intake,
});
const form = { title: ' Boiler service ', business_reason: 'Restore operation', priority: 'normal', required_by: '', description: 'Service visit', quantity: '999999999999999.999', unit: '' };
function memoryStorage() {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
}
(async () => {
  const storage = memoryStorage();
  const calls = [];
  // Simulate commit followed by a lost HTTP response. The next call sees the receipt.
  const committed = new Map();
  let loseResponse = true;
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    assert.ok(pending(storage, 'requester'), 'persist before the network request');
    committed.set(args.p_submission_key, 'request-1');
    if (loseResponse) { loseResponse = false; throw new Error('Connection lost after commit'); }
    return { data: committed.get(args.p_submission_key), error: null };
  } };
  await assert.rejects(save(client, storage, 'requester', form, () => 'stable-key'), /Connection lost/);
  assert.equal(pending(storage, 'requester').key, 'stable-key');
  assert.equal(pending(storage, 'someone-else'), null);
  await assert.rejects(save(client, storage, 'requester', { ...form, title: 'Different job' }, () => 'new-key'), /previous save is unconfirmed/);
  assert.equal(calls.length, 1, 'changed payload must not be sent');
  const restored = pending(storage, 'requester').payload;
  assert.equal(await save(client, storage, 'requester', restored, () => { throw new Error('must reuse key'); }), 'request-1');
  assert.equal(calls[0].args.p_submission_key, calls[1].args.p_submission_key);
  assert.equal(calls[0].args.p_payload.quantity, '999999999999999.999');
  assert.equal(committed.size, 1);
  assert.equal(pending(storage, 'requester'), null);
  let submitted = false;
  const noNetwork = { rpc: async () => { submitted = true; return { data: 'x', error: null }; } };
  await assert.rejects(save(noNetwork, { ...storage, setItem: () => { throw new Error('Storage unavailable'); } }, 'requester', form, () => 'key'), /Storage unavailable/);
  assert.equal(submitted, false);
  const errorClient = { rpc: async () => ({ data: null, error: { message: 'Access denied' } }) };
  await assert.rejects(save(errorClient, storage, 'requester', form, () => 'key-2'), /Access denied/);
  assert.equal(pending(storage, 'requester').key, 'key-2', 'do not discard unconfirmed attempts');
  for (const raw of ['not-json', '{}', JSON.stringify({ key: 'x', payload: { ...form, title: 12 } })]) {
    const broken = { ...storage, getItem: () => raw };
    assert.throws(() => pending(broken, 'requester'), /could not be restored/);
    await assert.rejects(save(noNetwork, broken, 'requester', form, () => 'key'), /could not be restored/);
  }
  assert.equal(submitted, false, 'corrupt recovery state must not silently create another request');
  console.log('Procurement draft client tests passed: lost response, refresh recovery, changed payload, exact decimal, actor isolation and storage failure.');
})().catch(error => { console.error(error); process.exitCode = 1; });
