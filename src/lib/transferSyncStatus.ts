export interface TransferSyncLog {
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
  sage_response?: { environment?: string; postedAtUtc?: string; sagePosting?: string } | null;
  error_details?: { postingOutcomeUnknown?: boolean } | null;
}

export function transferSyncStatus(log?: TransferSyncLog, now = Date.now()) {
  if (!log) return { label: 'No Sage confirmation', tone: 'slate', confirmed: false, delayed: false };
  const environment = log.sage_response?.environment;
  if (log.status === 'success') {
    if (environment && environment.toLowerCase() !== 'production') {
      return { label: `${environment} response: verify Production`, tone: 'amber', confirmed: false, delayed: false };
    }
    return { label: 'Sage posting confirmed', tone: 'emerald', confirmed: true, delayed: false };
  }
  if (log.status === 'failed' && log.error_details?.postingOutcomeUnknown) {
    return { label: 'Sage outcome unknown: verification required', tone: 'rose', confirmed: false, delayed: false };
  }
  if (log.status === 'failed') return { label: 'Sage error: review before retry', tone: 'rose', confirmed: false, delayed: false };
  const started = Date.parse(log.created_at || log.updated_at || '');
  const minutes = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 60000)) : null;
  const age = minutes === null ? '' : minutes < 1 ? ' (<1 min)' : ` (${minutes} min)`;
  const delayed = minutes !== null && minutes >= 5;
  const stage = log.status === 'processing' ? 'Processing; Sage not confirmed' : log.status === 'pending_finance_review' ? 'Awaiting Finance' : 'Queued; Sage not confirmed';
  return { label: `${delayed ? 'Delayed: ' : ''}${stage}${age}`, tone: delayed ? 'rose' : 'amber', confirmed: false, delayed };
}
