import { format, parseISO } from 'date-fns';

export function incomingIstDate(transfers: { transfer_date?: string | null }[]) {
  const dates = transfers.map(transfer => transfer.transfer_date);
  if (!dates.length || dates.some(date => !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date)) {
    return { value: null, label: 'Not recorded' };
  }
  if (new Set(dates).size !== 1) return { value: null, label: 'Mixed dates' };
  const value = dates[0]!;
  return { value, label: format(parseISO(value), 'dd MMM yyyy') };
}
