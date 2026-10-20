const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/incomingReceiptSafety.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exported });
const { incomingReceiptBlockReason } = exported;
const rows = Array.from({ length: 12 }, (_, index) => ({ id: `line-${index}`, status: index < 7 ? 'received' : 'in_buffer' }));
const pending = rows.filter(line => line.status === 'in_buffer');
const posted = Object.fromEntries(rows.slice(0, 7).map(line => [line.id, { sync_status: 'success' }]));
assert.equal(pending.length, 5);
assert.equal(incomingReceiptBlockReason(pending, posted, {}), null);
assert.ok(incomingReceiptBlockReason(rows, posted, {}));
assert.ok(incomingReceiptBlockReason([], {}, {}));
assert.ok(incomingReceiptBlockReason([{ ...pending[0], production_approved_at: '2026-10-20' }], {}, {}));
for (const status of ['success', 'pending', 'processing', 'failed', 'retry']) {
  assert.match(incomingReceiptBlockReason(pending, { [pending[0].id]: { sync_status: status } }, {}), /queue history/);
}
assert.match(incomingReceiptBlockReason(pending, {}, { [pending[0].id]: { status: 'posted' } }), /return record/);
assert.equal(incomingReceiptBlockReason(pending, {}, { [pending[0].id]: { status: 'cancelled' } }), null);
const page = fs.readFileSync('src/pages/ProductionWarehousePage.tsx', 'utf8');
assert.match(page, /for \(const transfer of bundle\.pendingTransfers\)/);
assert.match(page, /Resume \$\{bundle\.pendingTransfers\.length\}/);
assert.match(page, /setReceiptChecksReady\(!pendingError && !incomingSyncError && !incomingReversalsError\)/);
console.log('PASS: HFIST11965 seven received lines excluded, five remaining resumable; receipt/queue/return ambiguities blocked; failed safety reads disable receipt.');
