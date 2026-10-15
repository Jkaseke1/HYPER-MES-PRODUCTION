const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { sdkJson } = require('../lib/sdkHttp');

test('bounded SDK requests report uncertain writes and do not retry', async () => {
  let posts = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') posts++;
    req.resume();
    if (req.url === '/slow') return;
    res.end(req.url === '/invalid' ? 'not-json' : JSON.stringify({ status: 'posted', sagePosting: 'completed' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const result = await sdkJson(url, { method: 'POST', apiKey: 'test', body: { reference: 'fake' }, timeoutMs: 1000 });
    assert.equal(result.sagePosting, 'completed');
    await assert.rejects(sdkJson(url + '/slow', { method: 'POST', apiKey: 'test', body: {}, timeoutMs: 50 }), e => e.postingOutcomeUnknown === true && e.code === 'SDK_REQUEST_TIMEOUT');
    await assert.rejects(sdkJson(url + '/slow', { apiKey: 'test', timeoutMs: 50 }), e => e.postingOutcomeUnknown === false);
    await assert.rejects(sdkJson(url + '/invalid', { method: 'POST', apiKey: 'test', body: {}, timeoutMs: 1000 }), e => e.postingOutcomeUnknown === true);
    assert.equal(posts, 3, 'no POST was automatically retried');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('serial transfers record confirmation without waiting for stock refresh', async () => {
  const trace = [];
  const events = ['one', 'two'].map(id => ({ id, reference_id: id, event_type: 'material_transfer_to_production', details: {} }));
  const saved = [];
  class Query {
    select() { return this; } eq(key, value) { this.filters ||= {}; this.filters[key] = value; return this; }
    neq() { return this; } in() { return this; } order() { return this; } limit() { return this; }
    update(payload) { this.payload = payload; return this; }
    maybeSingle() { return Promise.resolve({ data: { id: this.filters.id }, error: null }); }
    then(resolve, reject) {
      if (this.payload?.status === 'success') { trace.push('confirmed:' + this.filters.id); saved.push(this.payload); }
      return Promise.resolve({ data: this.payload ? null : this.filters?.status === 'pending' ? events : [], error: null }).then(resolve, reject);
    }
  }
  const db = { DRY_RUN: false, supabase: { from: () => new Query() } };
  const transfer = { handleMaterialTransferToProduction: async event => {
    trace.push('post:' + event.id);
    return { sage_response: { status: 'posted', sagePosting: 'completed', postedAtUtc: '2026-10-15T10:00:00Z' }, details: { sdkTransfer: { itemCode: event.id } } };
  } };
  const stock = { syncSageStock: () => { trace.push('stock'); return new Promise(() => {}); } };
  const workerPath = path.join(__dirname, '..', 'bridgeWorker.js');
  const source = fs.readFileSync(workerPath, 'utf8').replace(/startWorker\(\);\s*$/, 'module.exports = { processPendingEvents };');
  const sandbox = { module: { exports: {} }, console: { log() {}, error() {}, warn() {} },
    process: { env: {}, on() {} }, setTimeout, clearTimeout, setInterval,
    require: name => name === './lib/db' ? db : name === './materialTransferSdkAuto' ? transfer : name === './sageStockSync' ? stock : {},
  };
  vm.runInNewContext(source, sandbox, { filename: workerPath });
  await sandbox.module.exports.processPendingEvents();
  await Promise.resolve();
  assert.deepEqual(trace.slice(0, 4), ['post:one', 'confirmed:one', 'post:two', 'confirmed:two']);
  assert.equal(saved.length, 2);
  assert.ok(saved.every(row => row.details.bridgeStartedAt && row.details.sageConfirmedAt));
  assert.equal(trace.filter(step => step === 'stock').length, 1);
});
