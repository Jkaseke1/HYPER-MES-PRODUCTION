import { supabase } from './supabase';

export interface AccessLogEntry {
  user_id?: string;
  user_email: string;
  user_name?: string;
  role?: string;
  event_type: 'login' | 'logout' | 'page_view' | 'action';
  module?: string;
  action_details: string;
  ip_address?: string;
  user_agent?: string;
  created_at?: string;
}

// Global cache to throttle page_view logging per module per session
const loggedModules = new Set<string>();

export async function logUserAccess(entry: AccessLogEntry) {
  try {
    // Avoid spamming duplicate page views for the same module in the same session
    if (entry.event_type === 'page_view' && entry.module) {
      const cacheKey = `${entry.user_email}_${entry.module}`;
      if (loggedModules.has(cacheKey)) return;
      loggedModules.add(cacheKey);
    }

    const payload = {
      user_id: entry.user_id || null,
      user_email: entry.user_email,
      user_name: entry.user_name || entry.user_email.split('@')[0],
      role: entry.role || 'user',
      event_type: entry.event_type,
      module: entry.module || 'General',
      action_details: entry.action_details,
      ip_address: entry.ip_address || '127.0.0.1',
      user_agent: entry.user_agent || (typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'),
      created_at: entry.created_at || new Date().toISOString(),
    };

    const { error } = await supabase.from('user_access_logs').insert([payload]);
    if (error && error.code === 'PGRST205') {
      console.info('[UserAccessLogger] Table user_access_logs pending migration.');
    }
  } catch (err) {
    console.warn('[UserAccessLogger] Failed to insert log:', err);
  }
}
