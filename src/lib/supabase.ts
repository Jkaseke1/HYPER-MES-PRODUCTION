import { createClient } from '@supabase/supabase-js';
import { isReadOnlyRole, mdRequestAllowed, MD_READ_ONLY_MESSAGE } from './readOnlyAccess';
import { backendAvailability } from './backendAvailability';

let sessionRole: string | null = null;
export function setSupabaseSessionRole(role: string | null) {
  sessionRole = role;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Each database request is sent once. The shared guard prevents outage retry storms.
const resilientFetch: typeof fetch = async (url, options) => {
  const requestUrl = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
  const method = options?.method || (url instanceof Request ? url.method : 'GET');
  if (isReadOnlyRole(sessionRole) && !mdRequestAllowed(requestUrl.pathname, method)) {
    return new Response(JSON.stringify({ code: '42501', message: MD_READ_ONLY_MESSAGE }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }
  return backendAvailability.fetch(url, options);
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: resilientFetch,
  },
});
