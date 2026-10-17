import { createClient } from '@supabase/supabase-js';
import { isReadOnlyRole, mdRequestAllowed, MD_READ_ONLY_MESSAGE } from './readOnlyAccess';

let sessionRole: string | null = null;
export function setSupabaseSessionRole(role: string | null) {
  sessionRole = role;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Custom resilient fetch with exponential backoff retry for network blips
const resilientFetch: typeof fetch = async (url, options) => {
  const requestUrl = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
  const method = options?.method || (url instanceof Request ? url.method : 'GET');
  if (isReadOnlyRole(sessionRole) && !mdRequestAllowed(requestUrl.pathname, method)) {
    return new Response(JSON.stringify({ code: '42501', message: MD_READ_ONLY_MESSAGE }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }
  const maxRetries = 3;
  let attempt = 0;
  let delay = 500;

  while (attempt < maxRetries) {
    try {
      return await fetch(url, options);
    } catch (err: any) {
      attempt++;
      if (attempt >= maxRetries || !navigator.onLine) {
        throw err;
      }
      console.warn(`[SupabaseFetch] Network blip (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`);
      await new Promise((res) => setTimeout(res, delay));
      delay *= 2;
    }
  }

  return fetch(url, options);
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: resilientFetch,
  },
});
