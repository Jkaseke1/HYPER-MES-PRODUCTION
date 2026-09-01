import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Custom resilient fetch with exponential backoff retry for network blips
const resilientFetch: typeof fetch = async (url, options) => {
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
