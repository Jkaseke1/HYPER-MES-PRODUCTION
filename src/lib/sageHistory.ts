import { transferSyncStatus, type TransferSyncLog } from './transferSyncStatus';

export interface SageHistoryLog extends TransferSyncLog {
  details?: { dryRun?: boolean; sdkTransfer?: { confirmPost?: boolean } } | null;
  sage_response?: NonNullable<TransferSyncLog['sage_response']> & { dryRun?: boolean };
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
