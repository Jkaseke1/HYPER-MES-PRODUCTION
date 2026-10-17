const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, requireMock = require) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: requireMock, console });
  return exports;
}
const readOnly = load('src/lib/readOnlyAccess.ts');
assert.equal(readOnly.isReadOnlyRole('md'), true);
assert.equal(readOnly.isReadOnlyRole('admin'), false);
for (const permission of ['grn.view', 'payroll.view', 'settings.view', 'reports.export']) {
  assert.equal(readOnly.isReadOnlyPermission(permission), true);
}
for (const permission of ['admin.full', 'admin.users', 'grn.approve', 'warehouse.transfer', 'production.complete']) {
  assert.equal(readOnly.isReadOnlyPermission(permission), false);
}
for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
  assert.equal(readOnly.mdRequestAllowed('/rest/v1/goods_received_notes', method), false);
  assert.equal(readOnly.mdRequestAllowed('/storage/v1/object/attachments/test.pdf', method), false);
}
for (const rpc of ['approve_grn_and_queue', 'request_sync_retry', 'get_next_batch_sequence', 'finalize_stock_take']) {
  for (const method of ['POST', 'GET']) assert.equal(readOnly.mdRequestAllowed(`/rest/v1/rpc/${rpc}`, method), false);
}
assert.equal(readOnly.mdRequestAllowed('/rest/v1/profiles', 'GET'), true);
assert.equal(readOnly.mdRequestAllowed('/rest/v1/user_access_logs', 'POST'), true);
assert.equal(readOnly.mdRequestAllowed('/rest/v1/user_access_logs', 'DELETE'), false);
assert.equal(readOnly.mdRequestAllowed('/storage/v1/object/sign/attachments', 'POST'), true);
assert.equal(readOnly.mdRequestAllowed('/auth/v1/token', 'POST'), true);
assert.equal(readOnly.mdRequestAllowed('/auth/v1/logout', 'POST'), true);
assert.equal(readOnly.mdRequestAllowed('/functions/v1/admin-create-user', 'POST'), false);
const access = load('src/lib/roleAccess.ts');
for (const route of ['/', '/payroll', '/admin/users', '/goods-received', '/production-orders', '/crm', '/settings']) {
  assert.equal(access.canAccessPath('md', route), true);
}
const approval = load('src/types/approval.ts');
for (const entity of Object.keys(approval.APPROVAL_PERMISSIONS)) assert.equal(approval.canApprove(entity, 'md'), false);

// A primary MD profile must remain read-only even with stale secondary admin grants.
let role = 'md';
const permissions = load('src/hooks/usePermissions.ts', name => {
  if (name === 'react') return {
    useState: () => [{ roles: ['admin'], permissions: new Set(['admin.full']), loading: false }, () => {}],
    useEffect() {}, useCallback: fn => fn,
  };
  if (name.includes('AuthContext')) return { useAuth: () => ({ user: { id: 'fixture' }, profile: { role } }) };
  if (name.includes('readOnlyAccess')) return readOnly;
  if (name.includes('supabase')) return { supabase: {} };
  throw new Error(name);
});
const md = permissions.usePermissions();
assert.equal(md.hasPermission('admin.full'), false);
assert.equal(md.hasPermission('grn.approve'), false);
assert.equal(md.hasPermission('grn.view'), true);
assert.equal(md.isAdmin(), false);
assert.equal(md.hasRole('admin'), false);
assert.equal(md.hasRole('md'), true);
assert.equal(md.roles.includes('admin'), false);
assert.equal(md.permissions.has('admin.full'), false);
role = 'admin';
assert.equal(permissions.usePermissions().hasPermission('grn.approve'), true);
console.log('MD read-only route, permission and request-policy tests passed. No live connections made.');
