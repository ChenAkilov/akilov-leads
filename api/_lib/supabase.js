import { createClient } from '@supabase/supabase-js';

export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Supabase misconfigured: SUPABASE_URL or SUPABASE_SERVICE_ROLE is missing');
  }
  const client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
