const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/transportPermissions.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject });
const { canEditGrnTransport } = exportsObject;
for (const role of ['admin', 'raw_material_manager', 'rm_manager', 'warehouse_manager']) {
  for (const grn of ['pending', 'pending_costing', 'pending_finance']) {
    for (const claim of [undefined, null, 'draft', 'rejected']) assert(canEditGrnTransport(role, grn, claim));
    for (const claim of ['submitted', 'approved', 'paid', 'cancelled', 'unknown']) assert(!canEditGrnTransport(role, grn, claim));
  }
  for (const grn of ['approved', 'rejected', 'cancelled', 'posted', 'unknown']) assert(!canEditGrnTransport(role, grn, 'draft'));
}
for (const role of ['md', 'finance_viewer', 'finance', 'accountant', 'weighbridge', 'weigh_bridge', 'operator', undefined]) {
  assert(!canEditGrnTransport(role, 'pending_finance', 'draft'));
}
const registration = fs.readFileSync('supabase/migrations/20261019160000_add_pending_transporter_registration.sql', 'utf8');
assert.match(registration, /Raw Materials cannot change the transport option/);
assert.doesNotMatch(registration, /SET inbound_transport_mode = 'company_hired'/);
const guard = fs.readFileSync('supabase/migrations/20261019170000_guard_grn_transport_detail_edits.sql', 'utf8');
assert.match(guard, /WHERE id = NEW.grn_id FOR UPDATE/);
assert.match(guard, /'details_updated'/);
assert.match(guard, /OLD.status NOT IN \('draft', 'rejected'\)/);
const completion = fs.readFileSync('supabase/migrations/20261019180000_complete_pending_grn_transporter.sql', 'utf8');
assert.match(completion, /WHERE id = p_grn_id FOR UPDATE/);
assert.match(completion, /WHERE id = v_grn.weigh_bridge_ticket_id FOR UPDATE/);
assert.match(completion, /'admin', 'raw_material_manager', 'rm_manager'/);
assert.match(completion, /A freight claim already uses this transporter/);
assert.match(completion, /NEW.inbound_transport_mode IS DISTINCT FROM OLD.inbound_transport_mode/);
assert.match(completion, /previous_transporter_id/);
console.log('Transport role/status matrix passed; SQL safeguards checked structurally, not executed.');
