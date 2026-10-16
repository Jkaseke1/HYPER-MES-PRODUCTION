const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(name, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, `../src/lib/${name}.ts`), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: key => {
    if (!(key in dependencies)) throw new Error(`Unexpected dependency: ${key}`);
    return dependencies[key];
  } });
  return exports;
}
const access = load('roleAccess');
const { dashboardModulesForRole, usesOperationsDashboard, operationsDashboardAccess } = load('dashboardAccess', { './roleAccess': access });
const roles = ['admin','md','weighbridge','weigh_bridge','production_receiver','warehouse_clerk','raw_material_manager','warehouse_manager','production_manager','supervisor','operator','logistics','finance','finance_viewer','accountant','maintenance_tech','procurement','unassigned',null,undefined];
for (const role of roles) {
  assert.equal(access.canAccessPath(role, '/'), true);
  for (const module of dashboardModulesForRole(role)) assert.equal(access.canAccessPath(role, module.path), true);
}
assert.equal(access.canAccessPath('weighbridge','/production-orders'), false);
assert.equal(access.canAccessPath('operator','/reports/gross-margin'), false);
assert.equal(access.canAccessPath('procurement','/goods-received'), false);
assert.equal(access.canAccessPath('finance_viewer','/admin-users'), false);
assert.equal(access.canAccessPath('unassigned','/goods-received'), false);
assert.equal(dashboardModulesForRole('unassigned').length, 0);
assert.equal(dashboardModulesForRole('procurement').length, 1);
assert.equal(dashboardModulesForRole('production_receiver').length, 1);
assert(!dashboardModulesForRole('weigh_bridge').some(module => module.table === 'production_orders'));
assert.equal(access.defaultPathForRole('weighbridge'), '/weigh-bridge', 'Existing role landing page preserved');
assert.equal(usesOperationsDashboard('raw_material_manager'), true);
assert.equal(usesOperationsDashboard('admin'), true);
assert.equal(usesOperationsDashboard('md'), true);
assert.equal(usesOperationsDashboard('unassigned'), false);
assert.equal(usesOperationsDashboard('weigh_bridge'), false);
const rm = operationsDashboardAccess('raw_material_manager');
assert.equal(rm.inventory, true);
assert.equal(rm.snapshots, true);
assert.equal(rm.production, false);
assert.equal(rm.dispatch, false);
assert.equal(rm.formulations, false);
assert.equal(rm.trends, false);
assert.equal(access.canAccessPath('raw_material_manager', '/admin-users'), false);
assert.equal(access.canAccessPath('raw_material_manager', '/production-orders'), false);
assert.equal(access.canAccessPath('raw_material_manager', '/dispatch'), false);
assert.equal(Object.values(operationsDashboardAccess('admin')).every(Boolean), true);
console.log('Dashboard permission checks passed: shared RM layout, unchanged restricted routes, scoped data capabilities and existing role landing pages.');
