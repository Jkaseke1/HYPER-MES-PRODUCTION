const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const Module = require('node:module');
const path = require('node:path');

const output = buildSync({
  entryPoints: [path.join(__dirname, '../src/lib/sageHistory.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false,
}).outputFiles[0].text;
const compiled = new Module('sage-history-test', module);
compiled._compile(output, 'sage-history-test.cjs');
const { sageHistoryStatus, harareDay, historyCsvCell } = compiled.exports;

const confirmed = { status: 'success', sage_response: { environment: 'Production', sagePosting: 'completed' } };
assert.equal(sageHistoryStatus(confirmed).confirmed, true);
assert.equal(sageHistoryStatus({ status: 'success' }).confirmed, false);
assert.equal(sageHistoryStatus({ status: 'success', sage_response: { environment: 'Production' } }).confirmed, false);
assert.equal(sageHistoryStatus({ status: 'success', sage_response: { environment: 'UAT' } }).confirmed, false);
assert.equal(sageHistoryStatus({ ...confirmed, details: { sdkTransfer: { confirmPost: false } } }).confirmed, false);
assert.match(sageHistoryStatus({ status: 'failed', error_details: { postingOutcomeUnknown: true } }).label, /unknown/);
assert.match(sageHistoryStatus({ status: 'failed', sage_response: { sagePosting: 'completed' } }).label, /reconciliation/);
assert.equal(sageHistoryStatus({ status: 'cancelled' }).label, 'cancelled');
assert.match(sageHistoryStatus({ status: 'pending', created_at: '2020-01-01T00:00:00Z' }).label, /Delayed/);
assert.equal(harareDay('2026-10-15T22:30:00Z'), '2026-10-16');
assert.equal(harareDay('invalid'), '');
assert.equal(historyCsvCell('a,"b"'), '"a,""b"""');
assert.equal(historyCsvCell(' =HYPERLINK("bad")').startsWith('"\''), true);
assert.equal(historyCsvCell(null), '""');
console.log('14 Sage history assertions passed; no database or Sage connections made.');

if (process.argv.includes('--preview')) {
  const fs = require('node:fs');
  const dir = path.join(__dirname, '../.tmp/sage-history-preview');
  fs.mkdirSync(dir, { recursive: true });
  buildSync({
    stdin: {
      contents: fs.readFileSync(path.join(__dirname, '../src/components/SageTransferHistory.tsx'), 'utf8')
        .replace("'../lib/supabase'", "'../../scripts/fixtures/sage-history-supabase'")
        + `\nimport { createRoot } from 'react-dom/client'; createRoot(document.getElementById('root')).render(<SageTransferHistory />);`,
      loader: 'tsx', resolveDir: path.join(__dirname, '../src/components'),
    },
    bundle: true, format: 'esm', jsx: 'automatic',
    outfile: path.join(dir, 'preview.js'),
  });
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:16px;background:#f8fafc"><div id="root"></div><script type="module">import '/src/index.css'; import './preview.js';</script></body></html>`);
  console.log('Mock-only browser fixture: /HYPER-MES-PRODUCTION/.tmp/sage-history-preview/index.html');
}
