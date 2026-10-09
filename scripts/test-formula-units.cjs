const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/formulaUnits.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exportsObject = {};
vm.runInNewContext(compiled, { exports: exportsObject });
const { formulaMassFactor, normalizeFormulaBom } = exportsObject;

for (const unit of ['kg', 'KG', 'Kgs', 'kilograms', 'kg.']) assert.equal(formulaMassFactor(unit), 1);
assert.equal(formulaMassFactor('g'), 0.001);
assert.equal(formulaMassFactor('mg'), 0.000001);
assert.equal(formulaMassFactor('tonnes'), 1000);
assert.equal(formulaMassFactor('litres'), null);

const materials = [{ id: 'maize', name: 'Maize', unit: 'kg' }, { id: 'bag', name: 'PACKAGING ASSORTED50KG', unit: 'each' }];
const sourceLines = [
  { raw_material_id: 'maize', quantity: 500000, unit: 'g' },
  { raw_material_id: 'salt', quantity: 0.5, unit: 't' },
  { raw_material_id: 'bag', quantity: 20, unit: 'each' },
];
const result = normalizeFormulaBom(sourceLines, materials, 1000);
assert.equal(result.totalKg, 1000);
assert.equal(result.mass.length, 2);
assert.equal(result.mass.reduce((sum, line) => sum + line.quantity, 0), 1000);
assert(result.mass.every(line => line.unit === 'kg'));
assert.equal(result.counted[0].quantity, 20);
assert.equal(result.counted[0].unit, 'each');
assert.equal(sourceLines[0].unit, 'g', 'source rows are not mutated');

const scaled = normalizeFormulaBom([
  { raw_material_id: 'maize', quantity: 50, unit: 'kg' },
  { raw_material_id: 'bag', quantity: 1, unit: 'each' },
], materials, 1000);
assert.equal(scaled.mass[0].quantity, 1000);
assert.equal(scaled.counted[0].quantity, 20);
assert.throws(() => normalizeFormulaBom([{ raw_material_id: 'oil', quantity: 2, unit: 'litres' }]), /Cannot convert/);
assert.throws(() => normalizeFormulaBom([{ raw_material_id: 'premix', quantity: 2, unit: 'each' }], [{ id: 'premix', name: 'Premix' }]), /Cannot convert/);
assert.throws(() => normalizeFormulaBom([{ raw_material_id: 'salt', quantity: -1, unit: 'kg' }]), /non-negative/);
assert.throws(() => normalizeFormulaBom([{ raw_material_id: 'bag', quantity: 20, unit: 'each' }], materials, 1000), /mass-based BOM/);
console.log('Formula unit tests passed: conversions, mass balance, packaging preservation, scaling, unsupported units and source immutability.');
