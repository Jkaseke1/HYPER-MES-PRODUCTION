const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/procurementIntake.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exported });
const { validateProcurementIntake: validate } = exported;
const valid = { title: 'Boiler service', business_reason: 'Restore operation', priority: 'normal', required_by: '', description: 'Service visit', quantity: '1', unit: 'each' };
assert.equal(validate(valid), null);
for (const quantity of ['', ' ', '0', '-1', 'NaN', 'Infinity', '1e3', '1,000', '0.0001', '1000000000000000', '1.2.3']) {
  assert.ok(validate({ ...valid, quantity }), `reject ${quantity}`);
}
for (const quantity of ['0.001', '1.125', '999999999999999.999', ' 2 ']) {
  assert.equal(validate({ ...valid, quantity }), null, `accept ${quantity}`);
}
for (const key of ['title', 'business_reason', 'description']) {
  assert.ok(validate({ ...valid, [key]: '  ' }));
}
for (const required_by of ['2026-02-30', '2026-13-01', '2026-1-01', 'invalid', '2026-10-20T12:00:00Z']) {
  assert.ok(validate({ ...valid, required_by }), `reject date ${required_by}`);
}
for (const required_by of ['2028-02-29', '2026-10-20']) {
  assert.equal(validate({ ...valid, required_by }), null);
}
assert.ok(validate({ ...valid, priority: 'approved' }));
console.log('Procurement intake tests passed: quantity bounds/precision, missing details, calendar dates and priority.');
