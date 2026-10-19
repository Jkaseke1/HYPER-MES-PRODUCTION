const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const exported = {};
vm.runInNewContext(compile(fs.readFileSync('src/lib/userAccessEditor.ts', 'utf8')), { exports: exported });
const roles = [
  { id: 'admin-id', code: 'admin', name: 'Administrator', is_active: true },
  { id: 'finance-id', code: 'finance', name: 'Finance', is_active: true },
];
assert.equal(exported.roleIdsIncludingPrimary('admin', [], roles)[0], 'admin-id');
assert.equal(exported.roleIdsIncludingPrimary('admin', ['admin-id'], roles).length, 1);
assert.equal(exported.userRoleLabels('admin', [], roles)[0].name, 'Administrator');
assert.equal(exported.userRoleLabels('admin', [{ roles: roles[0] }], roles).length, 1);
assert.throws(() => exported.roleIdsIncludingPrimary('missing', [], roles), /missing or inactive/);
assert.match(exported.userAccessSaveError({ code: '23505', message: 'uq_profiles_sage_agent_name' }), /No profile, role or branch changes were saved/);
const page = fs.readFileSync('src/pages/AdminUsersPage.tsx', 'utf8');
const save = page.slice(page.indexOf('  async function saveUserRoles()'), page.indexOf('  function openCreateUserModal()'));
const notices = [];
let closes = 0;
let reloads = 0;
let calls = 0;
let fail = true;
const ctx = {
  selectedUser: { id: 'target' }, saving: false, profile: { role: 'admin' }, isAdmin: () => true,
  userProfile: { full_name: 'Admin', email: 'it02@hyperfeeds.co.zw', phone: '', sage_agent_name: ' Em ', role: 'admin' },
  userRoles: [], userBranches: [], roles, ...exported,
  setSaving() {}, setUserModal() { closes++; }, fetchData: async () => { reloads++; },
  console: { error() {} }, toast: { error: message => notices.push(message), success: message => notices.push(message) },
  supabase: {
    from() { throw Error('Direct destructive client writes must not occur'); },
    rpc: async (name, payload) => {
      calls++;
      assert.equal(name, 'admin_save_user_access');
      assert.equal(payload.p_role_ids[0], 'admin-id');
      assert.equal(payload.p_sage_agent_name, 'Em');
      return fail ? { data: null, error: { code: '23505', message: 'uq_profiles_sage_agent_name' } } : { data: 'target', error: null };
    },
  },
};
vm.createContext(ctx);
vm.runInContext(compile(save), ctx);
async function main() {
  await ctx.saveUserRoles();
  assert.equal(closes, 0, 'Keep edit form open on save failure');
  assert.equal(reloads, 0);
  assert.match(notices[0], /already linked/);
  fail = false;
  await ctx.saveUserRoles();
  assert.equal(closes, 1);
  assert.equal(reloads, 1);
  ctx.profile.role = 'md';
  await ctx.saveUserRoles();
  assert.equal(calls, 2, 'MD cannot call the administrator mutation');
  const sql = fs.readFileSync('supabase/migrations/20261019210000_atomic_admin_user_access_save.sql', 'utf8');
  assert.match(sql, /coalesce\(v_actor.role,''\) IN \('md','finance_viewer'\)/);
  assert.match(sql, /You cannot remove your own administrator access/);
  assert.match(sql, /last administrator cannot be removed/);
  assert(sql.indexOf('INSERT INTO public.user_roles') < sql.indexOf('DELETE FROM public.user_roles'));
  assert.match(sql, /ON CONFLICT \(user_id, role_id\) DO NOTHING/);
  assert.doesNotMatch(sql, /EXCEPTION WHEN/i);
  assert.doesNotMatch(save, /\.delete\(/);
  console.log('Admin edit tests passed: primary-role fallback, agent-name conflict, failure retention, single RPC, and read-only denial. SQL safeguards checked structurally, not executed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
