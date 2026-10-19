const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const source = fs.readFileSync('src/lib/incomingIstDate.ts', 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const exported = {};
vm.runInNewContext(compile(source), { exports: exported, require });
const { incomingIstDate } = exported;
const fixture = { transfer_date: '2026-10-03', created_at: '2026-10-19T11:13:00Z' };
assert.equal(incomingIstDate([fixture]).value, '2026-10-03');
assert.equal(incomingIstDate([fixture]).label, '03 Oct 2026');
for (const invalid of [null, undefined, '', '2026-02-30', '2026-13-01', '03/10/2026']) {
  assert.equal(incomingIstDate([{ transfer_date: invalid, created_at: fixture.created_at }]).label, 'Not recorded');
}
assert.equal(incomingIstDate([fixture, { transfer_date: '2026-10-19' }]).label, 'Mixed dates');
assert.equal(incomingIstDate([fixture, {}]).value, null);
const page = fs.readFileSync('src/pages/ProductionWarehousePage.tsx', 'utf8');
const grouping = page.slice(page.indexOf('  const incomingBundles = useMemo'), page.indexOf('  const visibleIncomingBundles = useMemo'));
const context = {
  incomingTransfers: [fixture, { ...fixture, created_at: '2026-10-18T22:00:00Z' }].map((row, i) => ({
    ...row, id: String(i), quantity: 10, status: 'in_buffer', purpose: 'HFIST11959', requester: { full_name: 'Admin' },
  })),
  useMemo: fn => fn(), incomingIstDate,
};
vm.createContext(context);
vm.runInContext(compile(grouping + '\nglobalThis.bundles = incomingBundles;'), context);
assert.equal(context.bundles.length, 1, 'Legacy grouping uses the RM document date, not entry timestamp');
assert.equal(context.bundles[0].istDate.label, '03 Oct 2026');
assert.equal(context.bundles[0].totalQuantity, 20);
assert.match(page, /notes, transfer_date, created_at/);
assert.match(page, /bundle\.istDate\.label/);
assert.match(page, /expandedIncomingBundleData\.istDate\.label/);
assert.doesNotMatch(page, /IST date:<\/strong>\}\{format\(new Date\(expandedIncomingBundleData.createdAt/);
const child = `const vm=require('node:vm'),ts=require('typescript'),fs=require('node:fs');const e={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/incomingIstDate.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:e,require});process.stdout.write(e.incomingIstDate([{transfer_date:'2026-10-03'}]).label);`;
for (const TZ of ['Africa/Harare', 'America/Los_Angeles', 'Pacific/Auckland']) {
  assert.equal(execFileSync(process.execPath, ['-e', child], { env: { ...process.env, TZ }, encoding: 'utf8' }), '03 Oct 2026');
}
console.log('Incoming IST date tests passed: corrected RM date, separate creation time, missing/mixed dates, grouping and three time zones.');
