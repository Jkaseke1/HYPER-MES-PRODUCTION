const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('bridge/syncMasterData.js', 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function isPackagingItem('), source.indexOf('function isInSyncScope(')), context);
for (const name of ['PACKAGING PIG GROWER MEAL 50kg', 'PACKADGING PIG GROWER MEAL 50kg', 'packadging road runner 25kg']) {
  assert.equal(context.isPackagingItem({ code: 'PIPGM0001', name }), true, name);
}
for (const name of ['PIG GROWER MEAL 50kg', 'Solvent Soya', 'Full Fat Soya Meal', 'Limestone Flour', 'MACRO PACK', 'MAXIPACK', 'MACRO PACK ROAD RUNNER STARTER 20.4kg', 'Paragon -500ml']) {
  assert.equal(context.isPackagingItem({ code: 'FEED001', name }), false, name);
}
const scopeContext = { SYNC_CODES: [], SYNC_PREFIXES: [], SYNC_PACKAGING: true };
vm.createContext(scopeContext);
vm.runInContext(source.slice(source.indexOf('function isPackagingItem('), source.indexOf('async function syncRawMaterials(')), scopeContext);
assert.equal(scopeContext.isInSyncScope({ code: 'PIPGM0001', name: 'PACKADGING PIG GROWER MEAL 50kg' }), true);
assert.equal(scopeContext.isInSyncScope({ code: 'GMP001', name: 'GREEN MACRO PACK' }), false);
assert.equal(scopeContext.isInSyncScope({ code: 'BFPMAX', name: 'BROILER FINISHER MAXIPACK' }), false);
assert.equal(scopeContext.isInSyncScope({ code: 'PARA500', name: 'Paragon -500ml' }), false);
assert.match(source, /unit: isPackagingItem\(row\) \? 'units' : 'kg'/);
assert.match(fs.readFileSync('scripts/update-transfer-bridge.ps1', 'utf8'), /\$files = @\([^\r\n]*'syncMasterData.js'/);
console.log('Master packaging-unit tests passed: correct and legacy spelling, feed exclusions and installer coverage.');
