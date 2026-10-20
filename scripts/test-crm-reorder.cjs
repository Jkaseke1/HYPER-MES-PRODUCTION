// Run: npx esbuild src/lib/crmReorder.ts --format=cjs --outfile=.tmp-crmReorder.cjs && node scripts/test-crm-reorder.cjs
const assert = require('assert');
const path = require('path');
const r = require(path.join(__dirname, '..', '.tmp-crmReorder.cjs'));

const today = new Date('2026-10-20T10:00:00');
const sale = (date, code = 'A1', channel = 'hq_invoiced') => ({ invoice_date: date, sage_customer_code: code, sales_channel: channel });
const sales = [
  sale('2026-09-10'), sale('2026-09-20'), sale('2026-09-30'), sale('2026-10-04'),
  sale('2026-10-01', 'B2'), sale('2026-10-11', 'B2'), sale('2026-10-15', 'B2'),
  sale('2026-05-01', 'C3'), sale('2026-05-08', 'C3'), sale('2026-05-15', 'C3'),
  sale('2026-10-01', 'D4', 'branch_pos'), sale('2026-10-05', 'D4', 'branch_pos'), sale('2026-10-09', 'D4', 'branch_pos'),
  sale('2026-10-10', 'E5'), sale('2026-10-15', 'E5'),
];
const rhythms = r.buildRhythms(sales, today);

assert.deepStrictEqual(rhythms.get('A1'), { purchases: 4, typicalGapDays: 10, lastPurchase: '2026-10-04', daysSince: 16, expectedDate: '2026-10-14', daysOverdue: 6 });
assert.strictEqual(rhythms.get('B2').typicalGapDays, 7);
assert.ok(!rhythms.has('D4'), 'branch POS sales are not attributed to a customer rhythm');
assert.ok(!rhythms.has('E5'), 'two purchases are not enough to estimate a rhythm');

const customer = (id, code) => ({ id, legal_name: id, trading_name: null, sage_customer_code: code, primary_phone: '0772 123 456' });
const customers = [customer('a', 'A1'), customer('b', 'B2'), customer('c', 'C3')];
assert.deepStrictEqual(r.reorderReminders(customers, rhythms, []).map((x) => x.customer.id), ['a'], 'only the overdue, not-lapsed customer is due');

const contacted = [{ customer_id: 'a', activity_date: '2026-10-20T08:00:00Z', due_date: null, completed_at: '2026-10-20T08:00:00Z' }];
assert.deepStrictEqual(r.reorderReminders(customers, rhythms, contacted), [], 'contact after the expected date clears the reminder');
const scheduled = [{ customer_id: 'a', activity_date: '2026-10-01T08:00:00Z', due_date: '2026-10-25T09:00:00Z', completed_at: null }];
assert.deepStrictEqual(r.reorderReminders(customers, rhythms, scheduled), [], 'an open follow-up already covers the customer');
const old = [{ customer_id: 'a', activity_date: '2026-10-01T08:00:00Z', due_date: null, completed_at: '2026-10-01T08:00:00Z' }];
assert.strictEqual(r.reorderReminders(customers, rhythms, old).length, 1, 'contact before the expected date does not clear it');

assert.strictEqual(r.internationalPhone('0772 123 456'), '263772123456');
assert.strictEqual(r.internationalPhone('+263 77 212 3456'), '263772123456');
assert.strictEqual(r.internationalPhone('12'), null);
console.log('crmReorder: all checks passed');
