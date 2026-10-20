// Repeat-purchase rhythm from the imported Sage HQ invoice history.
// Reminders are derived on load rather than stored, so nothing is duplicated
// and a reminder disappears once anyone logs contact with the customer.

export type ReorderCustomer = { id: string; legal_name: string; trading_name: string | null; sage_customer_code: string | null; primary_phone: string | null; account_owner?: string | null };
export type ReorderSale = { invoice_date: string; sage_customer_code: string; sales_channel: string };
export type ReorderActivity = { customer_id: string; activity_date: string; due_date: string | null; completed_at: string | null };
export type Rhythm = { purchases: number; typicalGapDays: number; lastPurchase: string; daysSince: number; expectedDate: string; daysOverdue: number };
export type ReorderReminder<T extends ReorderCustomer> = { customer: T; rhythm: Rhythm };

const dayMs = 86400000;
const MIN_PURCHASES = 3;
const MIN_GAP_DAYS = 3;
// Customers this far past their rhythm are treated as lapsed (Customer health
// tab) instead of flooding the daily reorder list.
const MAX_OVERDUE_MULTIPLE = 3;

const toKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const fromKey = (key: string) => new Date(`${key}T00:00:00`);

export function buildRhythms(sales: ReorderSale[], today = new Date()): Map<string, Rhythm> {
  const start = new Date(today); start.setHours(0, 0, 0, 0);
  const dates = new Map<string, Set<string>>();
  for (const sale of sales) {
    if (sale.sales_channel !== 'hq_invoiced') continue;
    const code = sale.sage_customer_code.trim().toUpperCase();
    if (!code || fromKey(sale.invoice_date) > start) continue;
    if (!dates.has(code)) dates.set(code, new Set());
    dates.get(code)!.add(sale.invoice_date);
  }
  const rhythms = new Map<string, Rhythm>();
  for (const [code, set] of dates) {
    const sorted = [...set].sort();
    if (sorted.length < MIN_PURCHASES) continue;
    const gaps = sorted.slice(1).map((date, index) => Math.round((fromKey(date).getTime() - fromKey(sorted[index]).getTime()) / dayMs)).sort((a, b) => a - b);
    const middle = Math.floor(gaps.length / 2);
    const median = gaps.length % 2 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2;
    const typicalGapDays = Math.max(MIN_GAP_DAYS, Math.round(median));
    const lastPurchase = sorted[sorted.length - 1];
    const daysSince = Math.round((start.getTime() - fromKey(lastPurchase).getTime()) / dayMs);
    const expected = new Date(fromKey(lastPurchase).getTime() + typicalGapDays * dayMs);
    rhythms.set(code, { purchases: sorted.length, typicalGapDays, lastPurchase, daysSince, expectedDate: toKey(expected), daysOverdue: daysSince - typicalGapDays });
  }
  return rhythms;
}

export function reorderReminders<T extends ReorderCustomer>(customers: T[], rhythms: Map<string, Rhythm>, activities: ReorderActivity[]): ReorderReminder<T>[] {
  const reminders: ReorderReminder<T>[] = [];
  for (const customer of customers) {
    const rhythm = rhythms.get(customer.sage_customer_code?.trim().toUpperCase() || '');
    if (!rhythm || rhythm.daysOverdue < 0 || rhythm.daysSince > rhythm.typicalGapDays * MAX_OVERDUE_MULTIPLE) continue;
    const handled = activities.some((a) => a.customer_id === customer.id && ((!a.completed_at && a.due_date) || a.activity_date.slice(0, 10) >= rhythm.expectedDate));
    if (!handled) reminders.push({ customer, rhythm });
  }
  return reminders.sort((a, b) => b.rhythm.daysOverdue / b.rhythm.typicalGapDays - a.rhythm.daysOverdue / a.rhythm.typicalGapDays);
}

// Local Zimbabwe numbers (07…) are converted to the 263 country code for WhatsApp.
export function internationalPhone(phone: string | null): string | null {
  const digits = (phone || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (digits.length < 9) return null;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0')) return `263${digits.slice(1)}`;
  return digits;
}

export function reorderMessage(customerName: string, rhythm: Rhythm): string {
  return `Hello ${customerName}, this is Hyperfeeds. It has been ${rhythm.daysSince} days since your last order. Would you like us to prepare your next feed order? Reply to this message or call us and we will arrange it.`;
}

export const whatsappLink = (phone: string, message: string) => `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
export const smsLink = (phone: string, message: string) => `sms:+${phone}?body=${encodeURIComponent(message)}`;
