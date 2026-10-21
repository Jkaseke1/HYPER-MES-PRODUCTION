const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/grnWeighbridgeDraft.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject });
const { grnLineFromWeighbridge: line } = exportsObject;
const material = { id: 'maize', code: 'MAW0001', unit: 'kg', is_active: true };
const ticket = { product_code: 'MAW0001', status: 'in_grn', driver_signed: true, nett_mass: '12500' };
assert.equal(line(ticket, [material]).material.id, 'maize');
assert.equal(line(ticket, [material]).receivedQty, 12500);
assert.equal(line({ ...ticket, driver_signed: false }, [material]).receivedQty, '');
assert.equal(line({ ...ticket, nett_mass: null }, [material]).receivedQty, '');
for (const mass of [0, -1, 'NaN', 'Infinity']) assert.equal(line({ ...ticket, nett_mass: mass }, [material]).receivedQty, '');
assert.equal(line(ticket, [{ ...material, unit: 'units' }]).receivedQty, '');
assert.equal(line({ ...ticket, product_code: ' SAGE-MAW ' }, [{ ...material, sage_code: 'sage-maw' }]).material.id, 'maize');
assert.throws(() => line({ ...ticket, product_code: '' }, [material]), /No product/);
assert.throws(() => line({ ...ticket, status: 'cancelled' }, [material]), /not available/);
assert.throws(() => line(ticket, []), /one active/);
assert.throws(() => line(ticket, [{ ...material, is_active: false }]), /one active/);
assert.throws(() => line(ticket, [material, { ...material, id: 'duplicate' }]), /one active/);
console.log('PASS: exact product/Sage-code mapping; verified signed kg only; no guessed costs, unsigned quantities or unit counts; missing/inactive/ambiguous materials rejected.');
