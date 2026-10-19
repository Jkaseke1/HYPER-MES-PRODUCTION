const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/transferQuantitySummary.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exported });
const { transferQuantitySummary } = exported;
const fixture = [
  ['PAS0050', 900, 'units'], ['PARR0050', 98, 'units'],
  ['LSN0001', 242.58, 'kg'], ['LAP0001', 137.5, 'kg'],
  ['PAF0050', 400, 'units'], ['BSP0001', 125, 'kg'],
  ['PARR0025', 52, 'units'], ['CHL0001', 10.2, 'kg'],
  ['SOD0001', 45.4, 'kg'], ['PAL0050', 200, 'units'],
  ['BFP0001', 120, 'kg'], ['MET0001', 235.6, 'kg'],
  ['PASC0025', 200, 'units'], ['CAR0001', 35, 'kg'],
].map(([code, quantity, unit]) => ({ code, quantity, unit }));
const number = value => value.toLocaleString(undefined, { maximumFractionDigits: 6 });
assert.equal(transferQuantitySummary(fixture), `${number(951.28)} kg + ${number(1850)} units`);
assert.equal(transferQuantitySummary([{ quantity: '118361.68', unit: 'kg' }]), `${number(118361.68)} kg`);
assert.equal(transferQuantitySummary([{ quantity: 2, unit: ' KGs ' }, { quantity: 3, unit: 'kilograms' }]), '5 kg');
assert.equal(transferQuantitySummary([{ quantity: 2, unit: 'unit' }, { quantity: 3, unit: 'units' }]), '5 units');
assert.equal(transferQuantitySummary([{ quantity: 2, raw_materials: { unit: 'units' } }]), '2 units');
assert.equal(transferQuantitySummary([{ quantity: 2, unit: 'litres' }, { quantity: 3, unit: '' }]), '2 litres + 3 unit not recorded');
assert.equal(transferQuantitySummary([{ quantity: 0.1, unit: 'kg' }, { quantity: 0.2, unit: 'kg' }]), '0.3 kg');
assert.equal(transferQuantitySummary([]), '0');
assert.equal(transferQuantitySummary([{ quantity: 10, unit: 'kg' }, { quantity: -2, unit: 'kg' }]), '8 kg');
for (const file of ['src/pages/MaterialTransferPage.tsx', 'src/pages/ProductionWarehousePage.tsx']) {
  const page = fs.readFileSync(file, 'utf8');
  assert.match(page, /transferQuantitySummary/);
  assert.doesNotMatch(page, /totalQuantity\.toLocaleString\(\)\} kg/);
  assert.doesNotMatch(page, /Transfer quantity \(kg\)/);
}
console.log('Quantity summary tests passed: HFIST11960 screenshot fixture = 951.28 kg + 1,850 units; aliases, missing units, precision and both page integrations checked.');
