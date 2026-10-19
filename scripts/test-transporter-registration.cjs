const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, dependencies = {}) {
  const exports = {};
  const source = fs.readFileSync(file, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => dependencies[name] || require(name), console });
  return exports;
}
const rules = load('src/lib/transporterRegistration.ts');
for (const status of ['pending', 'missing', '', undefined, null, 'unexpected']) assert.equal(rules.transporterRegistrationBlocksApproval(status), true);
for (const status of ['legacy', 'verified', 'not_required']) assert.equal(rules.transporterRegistrationBlocksApproval(status), false);
async function verify() {
  let hook = 0;
  const { default: Approval } = load('src/components/approval/GRNApprovalButtons.tsx', {
    react: { ...React, useState: initial => { hook++; return [initial, () => {}]; } },
    '../../lib/supabase': { supabase: {} },
    '../../context/AuthContext': { useAuth: () => ({ profile: { role: 'finance' } }) },
    '../grn/FinanceTransporterReview': { default: () => null },
  });
  const approvalHtml = renderToStaticMarkup(React.createElement(Approval, {
    grnId: 'fixture', currentStatus: 'pending_finance', vatReviewedAt: '2026-10-19', onApproved() {}, onRejected() {},
  }));
  assert.match(approvalHtml, /disabled="" title="Resolve the transporter registration before approval\."/);
  assert(hook > 0);
  for (const role of ['admin', 'finance', 'accountant', 'finance_viewer', 'md', 'raw_material_manager']) {
    let stateIndex = 0;
    let effect;
    const blocked = [];
    const record = { registration_status: 'pending', transporter_id: 'fixture', transporter_name: 'BlexExpress', contact_phone: 'test', registration_note: 'New supplier' };
    const response = { data: record, error: null };
    const query = { select() { return this; }, eq() { return this; }, single() { return Promise.resolve(response); } };
    const { default: Panel } = load('src/components/grn/FinanceTransporterReview.tsx', {
      react: { ...React, useState: initial => [stateIndex++ === 0 ? record : initial, () => {}], useEffect: fn => { effect = fn; } },
      '../../lib/supabase': { supabase: { from: () => query } },
      '../../context/AuthContext': { useAuth: () => ({ profile: { role } }) },
      '../../lib/transporterRegistration': rules,
    });
    const html = renderToStaticMarkup(React.createElement(Panel, { grnId: 'fixture', onBlocked: value => blocked.push(value) }));
    assert.match(html, /BlexExpress/);
    assert.match(html, /Finance action required/);
    assert.equal(html.includes('Find supplier'), ['admin','finance','accountant'].includes(role));
    effect();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(blocked, [true, true]);
  }
  const sql = fs.readFileSync('supabase/migrations/20261019160000_add_pending_transporter_registration.sql', 'utf8');
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /'pending'/);
  assert.match(sql, /GRN approval blocked/);
  assert.match(sql, /BEFORE INSERT OR UPDATE OF status/);
  assert.match(sql, /sage_supplier_account = btrim\(v_supplier.sage_code\)/);
  assert.match(sql, /registration_audit = registration_audit \|\|/);
  assert.match(sql, /Transporter is locked after this ticket is linked/);
  for (const role of ['admin', 'raw_material_manager', 'rm_manager', 'finance', 'finance_viewer', 'md', 'weighbridge']) {
    let index = 0;
    const { default: Details } = load('src/components/grn/PendingTransporterDetails.tsx', {
      react: { ...React, useState: initial => [index++ === 0 ? { sage_registration_status: 'pending' } : initial, () => {}], useEffect() {} },
      '../../context/AuthContext': { useAuth: () => ({ profile: { role } }) },
      '../../lib/supabase': { supabase: {} },
    });
    const html = renderToStaticMarkup(React.createElement(Details, { grnId: 'grn', transporterId: 'transporter', onSaved() {} }));
    assert.equal(html.includes('Save transporter details'), ['admin', 'raw_material_manager', 'rm_manager'].includes(role));
  }
  const completion = fs.readFileSync('supabase/migrations/20261019180000_complete_pending_grn_transporter.sql', 'utf8');
  assert.match(completion, /sage_registration_status <> 'pending'/);
  assert.match(completion, /This transporter is shared or has freight evidence/);
  assert.match(completion, /'pending_details_updated'/);
  const setup = fs.readFileSync('docs/sql/grn-transport-setup.sql', 'utf8').replace(/\r\n/g, '\n');
  assert.equal((setup.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((setup.match(/^COMMIT;$/gm) || []).length, 1);
  for (const file of ['20261019160000_add_pending_transporter_registration.sql', '20261019170000_guard_grn_transport_detail_edits.sql', '20261019180000_complete_pending_grn_transporter.sql']) {
    const source = fs.readFileSync('supabase/migrations/' + file, 'utf8').replace(/\r\n/g, '\n').replace(/^BEGIN;\s*$/gm, '').replace(/^COMMIT;\s*$/gm, '').trim();
    assert(setup.includes(source), 'Combined setup matches migration: ' + file);
  }
  console.log('Transporter approval-state and Finance/MD/viewer display tests passed. SQL structure checked, not executed.');
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
