import { transferSyncStatus, type TransferSyncLog } from './transferSyncStatus';

export interface SageHistoryLog extends TransferSyncLog {
  details?: { dryRun?: boolean; sdkTransfer?: { confirmPost?: boolean; reference?: string } } | null;
  sage_response?: NonNullable<TransferSyncLog['sage_response']> & { dryRun?: boolean };
}

interface GroupableHistory extends SageHistoryLog {
  id: string;
  reference_id?: string;
  event_type?: string;
  original?: { id?: string; purpose?: string };
  record?: { original_transfer_id?: string };
}

export function groupHistoryByIst<T extends GroupableHistory>(rows: T[]) {
  const groups = new Map<string, { key: string; label: string; rows: T[] }>();
  for (const row of rows) {
    const ist = [row.original?.purpose, row.details?.sdkTransfer?.reference]
      .map(value => value?.match(/\bHFIST[\s-]*(\d+)\b/i)?.[1]).find(Boolean);
    // Do not merge unrelated events just because their IST metadata is missing.
    const key = ist ? `HFIST${ist}` : `unlinked:${row.original?.id || row.record?.original_transfer_id || row.reference_id || row.id}`;
    const group = groups.get(key) || { key, label: ist ? `HFIST${ist}` : 'IST not recorded', rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const confirmed = group.rows.filter(row => sageHistoryStatus(row).confirmed).length;
    const failed = group.rows.filter(row => row.status === 'failed').length;
    const queued = group.rows.filter(row => ['pending', 'retry', 'processing'].includes(row.status)).length;
    const review = group.rows.length - confirmed - queued;
    const returns = group.rows.filter(row => row.event_type === 'material_transfer_return_to_rm').length;
    const latest = group.rows.reduce((value, row) => {
      const timestamp = row.updated_at || row.created_at || '';
      return timestamp > value ? timestamp : value;
    }, '');
    return {
      ...group, confirmed, failed, queued, returns, latest,
      labelStatus: failed ? `${failed} failed; review required` : review ? 'Review required'
        : queued ? `${queued} awaiting confirmation` : 'All recorded events confirmed',
      tone: failed ? 'rose' : review || queued ? 'amber' : 'emerald',
    };
  }).sort((a, b) => b.latest.localeCompare(a.latest) || a.key.localeCompare(b.key));
}

export function sageHistoryStatus(row: SageHistoryLog) {
  if (row.details?.dryRun || row.sage_response?.dryRun || (row.status === 'success' && row.details?.sdkTransfer?.confirmPost === false)) {
    return { label: 'Dry run: not posted', tone: 'slate', confirmed: false };
  }
  if (row.status === 'success' && !row.sage_response?.environment) {
    return { label: 'Recorded success: environment not recorded', tone: 'amber', confirmed: false };
  }
  if (row.status === 'success' && row.sage_response?.environment?.toLowerCase() === 'production' && row.sage_response.sagePosting !== 'completed') {
    return { label: 'Recorded success: SDK posting marker unavailable', tone: 'amber', confirmed: false };
  }
  if (['cancelled', 'skipped'].includes(row.status)) return { label: row.status, tone: 'slate', confirmed: false };
  if (row.status === 'failed' && row.sage_response?.sagePosting === 'completed') {
    return { label: 'Sage outcome requires reconciliation', tone: 'rose', confirmed: false };
  }
  return transferSyncStatus(row);
}

export function harareDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Harare', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}

export function historyCsvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^\s*[=+@\-]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
