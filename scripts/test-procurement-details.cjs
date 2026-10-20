const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require });
  return exports;
}
const { loadProcurementDetails: read } = load('src/lib/procurementDetails.ts');
const View = load('src/components/procurement/ProcurementRequestDetails.tsx').default;
const fixtures = {
  maintenance_procurement_items: [{ id: 'item', line_number: 1, description: '<script>alert(1)</script>', quantity: '1.125', unit: 'each', specification: null }],
  maintenance_procurement_quotes: [{ id: 'quote', supplier_name: 'Supplier A', quote_reference: 'Q-1384263', quote_date: '2026-10-19', valid_until: null, currency_code: 'USD', quote_total: '11.64' }],
  maintenance_procurement_sage_history: [{ id: 'history', reference: 'Imported reference', transaction_date: '2026-10-20', transaction_type: 'CBAP', audit_number: 'audit-1', imported_at: '2026-10-20T10:00:00Z' }],
};
function fakeClient(overrides = {}) {
  const calls = [];
  const client = { from(table) {
    const call = { table }; calls.push(call);
    const builder = {
      select(fields, options) { call.fields = fields; call.options = options; return builder; },
      eq(column, value) { call.filter = [column, value]; return builder; },
      order() { return builder; },
      limit(value) { call.limit = value; return Promise.resolve(overrides[table] || { data: fixtures[table], count: fixtures[table].length, error: null }); },
    };
    return builder;
  } };
  return { client, calls };
}
(async () => {
  const { client, calls } = fakeClient();
  const details = await read(client, 'request-1');
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.filter[0], 'request_id'); assert.equal(call.filter[1], 'request-1');
    assert.equal(call.options.count, 'exact'); assert.equal(call.limit, 200);
    assert.doesNotMatch(call.fields, /\*|supplier_account|source_payload|attachment_path|sage_user|payment_amount/);
  }
  assert.equal(details.quotes[0].quote_reference, 'Q-1384263');
  for (const table of Object.keys(fixtures)) {
    await assert.rejects(read(fakeClient({ [table]: { data: null, count: null, error: { message: 'Denied' } } }).client, 'request-1'), /Could not load all/);
  }
  await assert.rejects(read(fakeClient({ maintenance_procurement_items: { data: fixtures.maintenance_procurement_items, count: 201, error: null } }).client, 'request-1'), /too large/);
  const props = { reference: 'MPR-2026-000001', title: 'Boiler work', details, loading: false, error: '', onRetry() {}, onClose() {} };
  const html = renderToStaticMarkup(React.createElement(View, props));
  assert.match(html, /MPR-2026-000001/); assert.match(html, /Q-1384263/); assert.match(html, /audit-1/);
  assert.match(html, /do not confirm bank settlement or supplier receipt/);
  assert.match(html, /do not confirm that an original document was uploaded or verified/);
  assert.doesNotMatch(html, /<script>/); assert.match(html, /&lt;script&gt;/);
  const failed = renderToStaticMarkup(React.createElement(View, { ...props, error: 'Could not load all request details.' }));
  assert.match(failed, /role="alert"/); assert.doesNotMatch(failed, /Q-1384263/);
  const loading = renderToStaticMarkup(React.createElement(View, { ...props, loading: true }));
  assert.match(loading, /Loading request details/); assert.doesNotMatch(loading, /Q-1384263/);
  const empty = renderToStaticMarkup(React.createElement(View, { ...props, details: { items: [], quotes: [], history: [] } }));
  assert.match(empty, /No item records found/); assert.match(empty, /No imported Sage records found/);
  console.log('Procurement detail tests passed: request-scoped reads, restricted fields, incomplete-data rejection, evidence labels, escaped content and loading/error/empty views.');
})().catch(error => { console.error(error); process.exitCode = 1; });
