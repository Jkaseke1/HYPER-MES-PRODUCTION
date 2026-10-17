const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

let role = 'raw_material_manager';
let sidebar = false;
let effects = [];
let queries = [];
let subscriptions = [];
const hooks = {
  ...React,
  useState: initial => [initial === true ? false : sidebar && initial === null ? 'Production' : initial, () => {}],
  useEffect: callback => { effects.push(callback); },
  useMemo: callback => callback(), useCallback: callback => callback,
  useRef: value => ({ current: value }),
};
function query(table) {
  queries.push(table);
  const builder = new Proxy({}, { get: (_, key) => key === 'then'
    ? resolve => Promise.resolve({ data: [], count: 0, error: null }).then(resolve)
    : () => builder });
  return builder;
}
const channel = { on: (_kind, config) => { subscriptions.push(config.table); return channel; }, subscribe() { return channel; } };
const auth = { useAuth: () => ({ profile: { id: role, role, full_name: 'Fixture User' }, signOut() {} }) };
const Link = ({ to, children, className }) => React.createElement('a', { href: to, className }, children);
const NavLink = ({ children, className, ...props }) => React.createElement(Link,
  { ...props, className: typeof className === 'function' ? className({ isActive: false }) : className },
  typeof children === 'function' ? children({ isActive: false }) : children);
const modules = {};
function load(relative) {
  if (modules[relative]) return modules[relative];
  const source = fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {};
  const localRequire = name => {
    if (name === 'react') return hooks;
    if (name === 'react-router-dom') return { Link, NavLink, useLocation: () => ({ pathname: '/' }), useNavigate: () => () => {} };
    if (name.endsWith('/AuthContext')) return auth;
    if (name.endsWith('/supabase')) return { supabase: { from: query, channel: () => channel, removeChannel() {} } };
    if (name.endsWith('/roleAccess')) return load('lib/roleAccess.ts');
    if (name.endsWith('/dashboardAccess')) return load('lib/dashboardAccess.ts');
    if (name.endsWith('/types/approval')) return load('types/approval.ts');
    if (name.endsWith('/RoleDashboard')) return { __esModule: true, default: () => React.createElement('div', null, 'Legacy role dashboard') };
    if (name.endsWith('/PendingApprovalsWidget')) return load('components/dashboard/PendingApprovalsWidget.tsx');
    if (name.endsWith('/StatusBadge')) return { __esModule: true, default: ({ status }) => React.createElement('span', null, status) };
    if (name === 'recharts') return new Proxy({}, { get: () => () => null });
    return require(name);
  };
  vm.runInNewContext(code, { exports, require: localRequire, console, Date, setTimeout, clearTimeout,
    document: { hidden: false, addEventListener() {}, removeEventListener() {} } });
  modules[relative] = exports;
  return exports;
}
async function verify() {
  const Dashboard = load('pages/DashboardPage.tsx').default;
  const html = renderToStaticMarkup(React.createElement(Dashboard));
  assert.match(html, /Operations floor/);
  assert.match(html, /Twelve-month movement/);
  assert.match(html, /Recent production/);
  assert.match(html, /Reorder/);
  assert.match(html, /Production orders: access restricted/);
  assert.doesNotMatch(html, /href="\/production-orders"/);
  assert.match(html, /href="\/warehouse"/);
  for (const effect of effects) effect();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert(queries.includes('raw_materials'));
  assert(queries.includes('sage_stock_balances'));
  for (const table of ['production_orders', 'formulations', 'dispatch_orders', 'monthly_operations_trends']) {
    assert(!queries.includes(table), `RM dashboard must not query ${table}`);
    assert(!subscriptions.includes(table), `RM dashboard must not subscribe to ${table}`);
  }
  effects = [];
  role = 'admin';
  const admin = renderToStaticMarkup(React.createElement(Dashboard));
  assert.match(admin, /Operations floor/);
  assert.match(admin, /href="\/production-orders"/);
  assert.doesNotMatch(admin, /Access restricted/);
  const access = load('lib/roleAccess.ts');
  const roles = ['admin', 'md', 'raw_material_manager', 'weighbridge', 'weigh_bridge', 'warehouse_clerk', 'warehouse_manager', 'production_receiver', 'production_manager', 'supervisor', 'operator', 'logistics', 'finance', 'finance_viewer', 'accountant', 'maintenance_tech', 'procurement', 'unassigned'];
  for (const current of roles) {
    role = current;
    effects = [];
    queries = [];
    subscriptions = [];
    const view = renderToStaticMarkup(React.createElement(Dashboard));
    assert.match(view, /Operations floor/, `${current} must use the shared layout`);
    assert.match(view, /Twelve-month movement/);
    assert.match(view, /Recent production/);
    assert.match(view, /Reorder/);
    for (const effect of effects) effect();
    await new Promise(resolve => setTimeout(resolve, 0));
    const scopes = {
      production_orders: '/production-orders', formulations: '/formulations', dispatch_orders: '/dispatch',
      raw_materials: '/warehouse', sage_stock_balances: '/warehouse', inventory_depletion_forecasts: '/warehouse',
      rm_daily_snapshots: '/rm-history', goods_received_notes: '/goods-received',
      material_transfers: '/material-transfer', chick_purchase_orders: '/chick-bookings',
      macropack_manufacture_orders: '/macropack', weigh_bridge_tickets: '/weigh-bridge',
    };
    for (const [table, route] of Object.entries(scopes)) {
      if (!access.canAccessPath(current, route)) {
        assert(!queries.includes(table), `${current} must not query ${table}`);
        assert(!subscriptions.includes(table), `${current} must not subscribe to ${table}`);
      }
    }
    if (!['/warehouse', '/production-orders', '/dispatch'].every(route => access.canAccessPath(current, route))) {
      assert(!queries.includes('monthly_operations_trends'), `${current} must not query combined trends`);
    }
    if (current === 'unassigned') assert.equal(queries.length, 0);
  }
  const Sidebar = load('components/layout/Sidebar.tsx').default;
  role = 'raw_material_manager';
  sidebar = true;
  const menu = renderToStaticMarkup(React.createElement(Sidebar, { collapsed: false, mobileMenuOpen: false, onToggle() {}, onMobileMenuClose() {} }));
  for (const group of ['Production', 'Administration', 'Customer Management']) assert(menu.includes(group));
  assert.match(menu, /Production Orders: access restricted/);
  assert.doesNotMatch(menu, /href="\/production-orders"/);
  console.log('Shared layout, approval visibility and query isolation checks passed for 18 roles; no live connections made.');
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
