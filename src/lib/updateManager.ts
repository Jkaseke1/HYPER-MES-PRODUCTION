import { supabase } from './supabase';
import { APP_VERSION, APP_BUILD_TIME } from '../config/version';

export interface SystemUpdatePayload {
  type: 'soft_update' | 'force_update';
  version: string;
  message: string;
  timestamp: string;
  admin_email?: string;
}

export interface SystemUpdateLogRecord {
  id: string;
  version: string;
  type: 'soft_update' | 'force_update';
  message: string;
  admin_email: string;
  timestamp: string;
}

export interface GitHubCommitRecord {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

export type UpdateStatusState = 'up_to_date' | 'soft_update_available' | 'force_update_pending';

export const UPDATE_CHANNEL_NAME = 'mes_system_updates_channel';
export const UPDATE_EVENT_NAME = 'system_update_event';
export const LAST_APPLIED_VERSION_KEY = 'hyper_mes_last_applied_version';
export const UPDATE_HISTORY_LOCAL_KEY = 'hyper_mes_update_broadcast_history_v1';

// Initial past releases list (excluding active base version v2.4.5)
const INITIAL_SYSTEM_RELEASES: SystemUpdateLogRecord[] = [
  {
    id: 'release-244',
    version: '2.4.4',
    type: 'soft_update',
    message: 'System access audit logging, MD executive role, and security enhancements.',
    admin_email: 'admin@hyperfeeds.co.zw',
    timestamp: '2026-07-30T10:00:00Z',
  },
  {
    id: 'release-240',
    version: '2.4.0',
    type: 'soft_update',
    message: 'Sage 50 inter-branch posting review engine and GRN approval workflow.',
    admin_email: 'admin@hyperfeeds.co.zw',
    timestamp: '2026-07-28T14:00:00Z',
  },
];

export function getInstalledVersion(): string {
  return APP_VERSION;
}

export function getNextVersion(currentVer: string = APP_VERSION): string {
  const clean = currentVer.replace('v', '').trim();
  const parts = clean.split('.').map(n => parseInt(n, 10));
  if (parts.length === 3 && !isNaN(parts[2])) {
    parts[2] += 1;
    return `v${parts.join('.')}`;
  }
  return `v${clean}-next`;
}

export function saveLastAppliedVersion(version: string) {
  try {
    localStorage.setItem(LAST_APPLIED_VERSION_KEY, version);
  } catch (e) {
    console.warn('Failed to save last applied version:', e);
  }
}

function getLocalHistory(): SystemUpdateLogRecord[] {
  try {
    const raw = localStorage.getItem(UPDATE_HISTORY_LOCAL_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('Error reading local update history:', e);
  }
  return [];
}

function saveLocalHistoryRecord(rec: SystemUpdateLogRecord) {
  try {
    const list = getLocalHistory();
    const filtered = list.filter(r => !(r.version === rec.version && r.type === rec.type));
    const updated = [rec, ...filtered].slice(0, 50);
    localStorage.setItem(UPDATE_HISTORY_LOCAL_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('Error saving local update record:', e);
  }
}

export async function broadcastSystemUpdate(
  type: 'soft_update' | 'force_update',
  version: string,
  message: string,
  adminEmail: string
) {
  const payload: SystemUpdatePayload = {
    type,
    version,
    message,
    timestamp: new Date().toISOString(),
    admin_email: adminEmail,
  };

  // 1. Broadcast over Supabase Realtime Channel
  const channel = supabase.channel(UPDATE_CHANNEL_NAME);
  await channel.subscribe();
  
  await channel.send({
    type: 'broadcast',
    event: UPDATE_EVENT_NAME,
    payload,
  });

  // 2. Save locally for guaranteed audit persistence across reloads
  const localRec: SystemUpdateLogRecord = {
    id: 'broadcast-' + Date.now(),
    version,
    type,
    message,
    admin_email: adminEmail,
    timestamp: payload.timestamp,
  };
  saveLocalHistoryRecord(localRec);

  // 3. Log in user_access_logs table if available
  try {
    await supabase.from('user_access_logs').insert([{
      user_email: adminEmail,
      event_type: 'action',
      module: 'System Management',
      action_details: `SYSTEM_UPDATE|[${type.toUpperCase()}]|v${version}|${message}`,
      ip_address: '127.0.0.1'
    }]);
  } catch (e) {
    console.warn('DB log skipped or table pending:', e);
  }
}

export async function fetchRecentSystemUpdates(): Promise<SystemUpdateLogRecord[]> {
  const localRecords = getLocalHistory();
  let dbRecords: SystemUpdateLogRecord[] = [];

  try {
    const { data, error } = await supabase
      .from('user_access_logs')
      .select('*')
      .eq('module', 'System Management')
      .order('created_at', { ascending: false })
      .limit(20);

    if (!error && data) {
      dbRecords = data.map((log: any) => {
        const details = log.action_details || '';
        let type: 'soft_update' | 'force_update' = 'soft_update';
        let version = APP_VERSION;
        let message = details;

        if (details.includes('SYSTEM_UPDATE')) {
          const parts = details.split('|');
          if (parts[1]?.includes('FORCE')) type = 'force_update';
          if (parts[2]) version = parts[2].replace('v', '');
          if (parts[3]) message = parts[3];
        } else if (details.toLowerCase().includes('force')) {
          type = 'force_update';
        }

        return {
          id: log.id,
          version,
          type,
          message,
          admin_email: log.user_email || 'admin@hyperfeeds.co.zw',
          timestamp: log.created_at,
        };
      });
    }
  } catch (e) {
    console.warn('Error fetching system updates history from DB:', e);
  }

  // Merge local, DB, and initial system releases
  const map = new Map<string, SystemUpdateLogRecord>();
  [...localRecords, ...dbRecords, ...INITIAL_SYSTEM_RELEASES].forEach(rec => {
    const key = `${rec.version}-${rec.type}`;
    if (!map.has(key)) {
      map.set(key, rec);
    }
  });

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export const INSTALLED_SHA_KEY = 'hyper_mes_installed_sha';

export async function fetchPendingUpdates(): Promise<SystemUpdateLogRecord[]> {
  const pending: SystemUpdateLogRecord[] = [];
  const installedSha = localStorage.getItem(INSTALLED_SHA_KEY);

  // 1. Check for new GitHub deployment commits
  const commits = await fetchGitHubCommits();
  if (commits.length > 0) {
    const latestCommit = commits[0];
    const commitTime = new Date(latestCommit.date).getTime();
    const buildTime = new Date(APP_BUILD_TIME).getTime();
    const isApplied = 
      localStorage.getItem(`hyper_mes_applied_${latestCommit.shortSha}`) === 'true' ||
      localStorage.getItem(`hyper_mes_applied_${latestCommit.sha}`) === 'true' ||
      localStorage.getItem(`hyper_mes_applied_2.4.6-${latestCommit.shortSha}`) === 'true' ||
      localStorage.getItem(`hyper_mes_applied_2.4.7-${latestCommit.shortSha}`) === 'true' ||
      installedSha === latestCommit.sha ||
      installedSha === latestCommit.shortSha;

    if (!isApplied && installedSha !== latestCommit.sha && commitTime > buildTime) {
      pending.push({
        id: latestCommit.sha,
        version: `${APP_VERSION}-${latestCommit.shortSha}`,
        type: 'soft_update',
        message: `New software build ready: ${latestCommit.message}`,
        admin_email: latestCommit.author,
        timestamp: latestCommit.date,
      });
    }
  }

  // 2. Check traditional release logs
  const allHistory = await fetchRecentSystemUpdates();
  const cleanCurrent = APP_VERSION.replace('v', '').trim().toLowerCase();

  for (const rec of allHistory) {
    const cleanRecVer = (rec.version || '').replace('v', '').trim().toLowerCase();
    const isApplied = localStorage.getItem(`hyper_mes_applied_${cleanRecVer}`) === 'true';
    if (cleanRecVer !== cleanCurrent && !isApplied) {
      if (!pending.some(p => p.version === rec.version)) {
        pending.push(rec);
      }
    }
  }

  return pending;
}

export async function fetchGitHubCommits(): Promise<GitHubCommitRecord[]> {
  try {
    const res = await fetch('https://api.github.com/repos/Jkaseke1/HYPER-MES/commits?per_page=6');
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data.map((item: any) => ({
      sha: item.sha,
      shortSha: item.sha.substring(0, 7),
      message: item.commit?.message?.split('\n')[0] || 'System update push',
      author: item.commit?.author?.name || 'Developer',
      date: item.commit?.author?.date || new Date().toISOString(),
    }));
  } catch (e) {
    console.warn('GitHub commits fetch skipped:', e);
    return [];
  }
}

export function computeUpdateStatus(
  installedVersion: string,
  latestBroadcast: SystemUpdatePayload | null
): { state: UpdateStatusState; label: string; badgeColor: string; description: string } {
  if (!latestBroadcast || latestBroadcast.version === installedVersion) {
    return {
      state: 'up_to_date',
      label: '🟢 UP TO DATE',
      badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-300',
      description: `Running latest build (${installedVersion}). System operating normally.`,
    };
  }

  if (latestBroadcast.type === 'soft_update') {
    return {
      state: 'soft_update_available',
      label: '🟡 UPDATE AVAILABLE',
      badgeColor: 'bg-amber-100 text-amber-800 border-amber-300',
      description: `New version (${latestBroadcast.version}) announced. Update available when convenient.`,
    };
  }

  return {
    state: 'force_update_pending',
    label: '🔴 CRITICAL PUSH ACTIVE',
    badgeColor: 'bg-red-100 text-red-800 border-red-300',
    description: `Critical update (${latestBroadcast.version}) forced by Admin. Auto-refresh in progress.`,
  };
}
