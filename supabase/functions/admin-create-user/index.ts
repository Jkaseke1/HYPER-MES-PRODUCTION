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
  const { data: { user: requester }, error: requesterError } = await userClient.auth.getUser();

  if (requesterError || !requester) return json({ error: 'Authentication is required.' }, 401);

  const { data: requesterProfile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', requester.id)
    .maybeSingle();

  const { data: adminRole } = await adminClient
    .from('user_roles')
    .select('roles!inner(code)')
    .eq('user_id', requester.id)
    .eq('roles.code', 'admin')
    .maybeSingle();

  if (requesterProfile?.role !== 'admin' && !adminRole) {
    return json({ error: 'Only administrators can create users.' }, 403);
  }

  const body = await request.json();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const fullName = String(body.full_name || '').trim();
  const phone = String(body.phone || '').trim();
  const role = String(body.role || 'operator');
  const roleIds = Array.isArray(body.role_ids) ? body.role_ids.filter((value: unknown) => typeof value === 'string') : [];
  const branchAccess = Array.isArray(body.branch_access) ? body.branch_access : [];

  if (!email || !password || !fullName) return json({ error: 'Email, password, and full name are required.' }, 400);
  if (password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
  });

  if (createError || !created.user) return json({ error: createError?.message || 'Auth user could not be created.' }, 422);

  const userId = created.user.id;
  try {
    const { error: profileError } = await adminClient.from('profiles').upsert({
      id: userId,
      email,
      full_name: fullName,
      phone,
      role,
    }, { onConflict: 'id' });
    if (profileError) throw profileError;

    if (roleIds.length) {
      const { error } = await adminClient.from('user_roles').insert(
        roleIds.map((roleId: string) => ({ user_id: userId, role_id: roleId })),
      );
      if (error) throw error;
    }

    if (branchAccess.length) {
      const { error } = await adminClient.from('user_branch_access').insert(
        branchAccess.map((branch: { branch_id: string; access_level: string }) => ({
          user_id: userId,
          branch_id: branch.branch_id,
          access_level: branch.access_level,
        })),
      );
      if (error) throw error;
    }
  } catch (error) {
    await adminClient.auth.admin.deleteUser(userId);
    return json({ error: error instanceof Error ? error.message : 'User profile setup failed.' }, 422);
  }

  return json({ user_id: userId });
});
