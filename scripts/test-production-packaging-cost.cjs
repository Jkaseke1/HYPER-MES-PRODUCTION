const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const compiled = ts.transpileModule(fs.readFileSync('src/lib/productionPackagingCost.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const context = { exports: {} };
vm.runInNewContext(compiled, context);
const { packagingCost, hasUncostedPackaging } = context.exports;
const items = [{ packaging_sku_id: 'PAL0050', planned_qty: 20, actual_qty: 20, unit_cost: 0.349 }];
assert.ok(Math.abs(packagingCost(items) - 6.98) < 1e-9);
assert.ok(Math.abs(474.932 + packagingCost(items) + 23.75 - 505.662) < 1e-9);
assert.equal(packagingCost([{ ...items[0], actual_qty: 0 }]), 0, 'Zero actual use must not become planned consumption');
assert.ok(Math.abs(packagingCost([{ ...items[0], actual_qty: 0 }], true) - 6.98) < 1e-9);
assert.ok(Math.abs(packagingCost(items, false, [{ packaging_sku_id: 'PAL0050', bags_used: 19 }]) - 6.631) < 1e-9);
assert.equal(hasUncostedPackaging([{ ...items[0], unit_cost: 0 }]), true);
assert.equal(hasUncostedPackaging([{ ...items[0], unit_cost: NaN }]), true);
assert.equal(hasUncostedPackaging([]), true);
assert.equal(hasUncostedPackaging(items), false);
console.log('PASS: packaging cost, actual/planned quantities, declaration quantities, unknown costs and managerial totals. No database calls.');
