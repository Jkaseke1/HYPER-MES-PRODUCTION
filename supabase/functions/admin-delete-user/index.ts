import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'POST is required.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return json({ error: 'The authenticated admin service is not configured.' }, 500);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: { user: requester } } = await userClient.auth.getUser();
  if (!requester) return json({ error: 'Authentication is required.' }, 401);

  const { data: requesterProfile } = await adminClient
    .from('profiles').select('role').eq('id', requester.id).maybeSingle();
  const { data: adminRole } = await adminClient
    .from('user_roles').select('roles!inner(code)').eq('user_id', requester.id)
    .eq('roles.code', 'admin').maybeSingle();
  if (requesterProfile?.role !== 'admin' && !adminRole) {
    return json({ error: 'Only administrators can delete users.' }, 403);
  }

  const body = await request.json();
  const userId = String(body.user_id || '');
  if (!userId) return json({ error: 'user_id is required.' }, 400);
  if (userId === requester.id) return json({ error: 'You cannot delete your own account.' }, 400);

  const { error: roleError } = await adminClient.from('user_roles').delete().eq('user_id', userId);
  if (roleError) return json({ error: roleError.message }, 422);
  const { error: branchError } = await adminClient.from('user_branch_access').delete().eq('user_id', userId);
  if (branchError) return json({ error: branchError.message }, 422);
  const { error: profileError } = await adminClient.from('profiles').delete().eq('id', userId);
  if (profileError) return json({ error: profileError.message }, 422);

  const { error: authError } = await adminClient.auth.admin.deleteUser(userId);
  if (authError) return json({ error: authError.message }, 422);
  return json({ user_id: userId });
});
