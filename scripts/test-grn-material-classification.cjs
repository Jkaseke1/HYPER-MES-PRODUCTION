const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/grnMaterials.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject });
const { grnMaterialGroup, isGrnInput } = exportsObject;
const material = { code: 'PARR0025', sage_code: '', name: 'PACKADGING ROAD RUNNER 25KG', category: '' };
assert.equal(grnMaterialGroup(material), 'Packaging');
assert.equal(isGrnInput(material, new Set()), true);
assert.equal(isGrnInput(material, new Set(['PARR0025'])), false, 'Finished-good exclusion remains authoritative');
const soya = { code: 'FFS0001', sage_code: '', name: 'Full Fat Soya Meal', category: 'protein' };
assert.equal(isGrnInput(soya, new Set(['FFS0001'])), true, 'Purchased Full Fat Soya remains receivable despite its formulation');
assert.equal(isGrnInput({ ...soya, code: 'OTHER' }, new Set(['OTHER'])), false);
assert.equal(isGrnInput({ ...soya, category: 'finished_goods' }, new Set(['FFS0001'])), false);
assert.equal(isGrnInput({ ...soya, name: 'Broiler Grower Feed' }, new Set(['FFS0001'])), false);
assert.equal(isGrnInput({ ...soya, sage_code: 'OTHER' }, new Set(['OTHER'])), false);
assert.equal(grnMaterialGroup({ name: 'PACKAGING BROILER FINISHER 50KG' }), 'Packaging');
assert.equal(grnMaterialGroup({ name: 'Wheat Bran' }), 'Raw materials');
assert.equal(grnMaterialGroup({ name: 'Broiler Starter Premix' }), 'Premixes');
assert.equal(grnMaterialGroup({ name: 'Lysine' }), 'Additives & minerals');
assert.equal(isGrnInput({ code: 'FEED', name: 'Broiler Finisher Feed' }, new Set()), false);
assert.equal(grnMaterialGroup({ name: 'Generic material', category: ' RAW_MATERIALS ' }), 'Raw materials');
assert.equal(grnMaterialGroup({ name: 'Wheat Bran', category: 'Packaging' }), 'Packaging', 'Recorded category takes precedence');
assert.equal(grnMaterialGroup({ name: 'Generic material', category: 'pre-mixes' }), 'Premixes');
assert.equal(grnMaterialGroup({ name: 'Generic material', category: 'additives_and_minerals' }), 'Additives & minerals');
assert.equal(grnMaterialGroup({ name: 'PACKADGING ROAD RUNNER 25KG', category: null }), 'Packaging');
assert.equal(grnMaterialGroup({ name: 'PRE MIX LAYER' }), 'Premixes');
for (const name of ['Chicken Carcass Meal', 'Low Fat Soya Meal', 'Lucerne Pellets', 'Millet', 'Fishmeal', 'Vegetable Oil']) {
  assert.equal(grnMaterialGroup({ name }), 'Raw materials', name);
}
for (const name of ['Magnesium Oxide', 'Calcium Carbonate', 'Choline Chloride', 'Sodium Bicarbonate']) {
  assert.equal(grnMaterialGroup({ name }), 'Additives & minerals', name);
}
assert.equal(grnMaterialGroup({ name: 'Paragon 500ml', code: 'PARA500' }), 'Other supplies');
assert.equal(grnMaterialGroup({ name: 'Unidentified input' }), 'Needs category review', 'Do not silently misclassify unknowns as supplies');
assert.equal(isGrnInput({ code: 'FEED', name: 'Broiler Finisher Feed', category: 'Raw materials' }, new Set()), false);
console.log('GRN packaging classification and finished-feed exclusion tests passed.');
