-- One transaction for profile, Sage-agent mapping, roles and branch assignments.
-- No existing user or business records are changed by applying this migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.admin_save_user_access(
  p_user_id uuid, p_full_name text, p_email text, p_phone text,
  p_sage_agent_name text, p_primary_role text, p_role_ids uuid[], p_branch_access jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_primary_id uuid;
  v_role_ids uuid[];
  v_old_roles uuid[];
BEGIN
  -- Serialize administrator edits, including last-administrator checks.
  PERFORM pg_advisory_xact_lock(hashtext('admin_save_user_access'));
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF NOT FOUND OR coalesce(v_actor.role,'') IN ('md','finance_viewer') OR
    (coalesce(v_actor.role,'') <> 'admin' AND NOT public.has_active_admin_role()) THEN
    RAISE EXCEPTION 'Only administrators may edit user access.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_target FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User profile not found.'; END IF;
  IF nullif(btrim(p_full_name),'') IS NULL OR nullif(btrim(p_email),'') IS NULL THEN
    RAISE EXCEPTION 'Full name and email are required.';
  END IF;
  SELECT id INTO v_primary_id FROM public.roles WHERE code = p_primary_role AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active primary role.'; END IF;
  SELECT array_agg(DISTINCT role_id) INTO v_role_ids
    FROM unnest(coalesce(p_role_ids, '{}'::uuid[]) || ARRAY[v_primary_id]) AS r(role_id);
  IF EXISTS (SELECT 1 FROM unnest(v_role_ids) AS x(id)
    LEFT JOIN public.roles r ON r.id = x.id WHERE r.id IS NULL OR r.is_active IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'One or more selected roles are missing or inactive.';
  END IF;
  IF p_primary_role = 'md' AND EXISTS (SELECT 1 FROM public.roles
    WHERE id = ANY(v_role_ids) AND code <> 'md') THEN
    RAISE EXCEPTION 'The read-only MD role cannot be combined with additional roles.';
  END IF;
  IF p_primary_role = 'finance_viewer' AND EXISTS (SELECT 1 FROM public.roles
    WHERE id = ANY(v_role_ids) AND code IN ('finance','admin','accountant')) THEN
    RAISE EXCEPTION 'Finance Viewer cannot be combined with Finance, Accountant or Administrator.';
  END IF;
  IF p_user_id = auth.uid() AND (v_target.role = 'admin' OR public.has_active_admin_role())
    AND p_primary_role <> 'admin'
    AND NOT EXISTS (SELECT 1 FROM public.roles WHERE id = ANY(v_role_ids) AND code = 'admin') THEN
    RAISE EXCEPTION 'You cannot remove your own administrator access.';
  END IF;
  IF (v_target.role = 'admin' OR EXISTS (
      SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = p_user_id AND r.code = 'admin' AND r.is_active))
    AND p_primary_role <> 'admin'
    AND NOT EXISTS (SELECT 1 FROM public.roles WHERE id = ANY(v_role_ids) AND code = 'admin')
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles other
      WHERE other.id <> p_user_id AND other.role NOT IN ('md','finance_viewer')
        AND (other.role = 'admin' OR EXISTS (
          SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
          WHERE ur.user_id = other.id AND r.code = 'admin' AND r.is_active))
    ) THEN RAISE EXCEPTION 'The last administrator cannot be removed.'; END IF;
  IF p_branch_access IS NULL OR jsonb_typeof(p_branch_access) <> 'array' THEN
    RAISE EXCEPTION 'Branch access must be an array.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_branch_access) AS x(branch_id uuid, access_level text)
    LEFT JOIN public.branches b ON b.id = x.branch_id
    WHERE b.id IS NULL OR b.is_active IS DISTINCT FROM true OR x.access_level IS NULL OR x.access_level NOT IN ('read','write','admin')
  ) OR (SELECT count(*) FROM jsonb_to_recordset(p_branch_access) AS x(branch_id uuid))
    <> (SELECT count(DISTINCT branch_id) FROM jsonb_to_recordset(p_branch_access) AS x(branch_id uuid)) THEN
    RAISE EXCEPTION 'Select distinct active branches with valid access levels.';
  END IF;
  SELECT array_agg(role_id ORDER BY role_id) INTO v_old_roles FROM public.user_roles WHERE user_id = p_user_id;

  -- Any failure below rolls back all profile, role and branch changes.
  UPDATE public.profiles SET full_name = btrim(p_full_name), email = btrim(p_email),
    phone = nullif(btrim(p_phone),''), sage_agent_name = nullif(btrim(p_sage_agent_name),''),
    role = p_primary_role, updated_at = now() WHERE id = p_user_id;
  INSERT INTO public.user_roles(user_id, role_id, assigned_by)
    SELECT p_user_id, id, auth.uid() FROM unnest(v_role_ids) AS x(id)
    ON CONFLICT (user_id, role_id) DO NOTHING;
  DELETE FROM public.user_roles WHERE user_id = p_user_id AND NOT (role_id = ANY(v_role_ids));
  INSERT INTO public.user_branch_access(user_id, branch_id, access_level, granted_by)
    SELECT p_user_id, x.branch_id, x.access_level, auth.uid()
    FROM jsonb_to_recordset(p_branch_access) AS x(branch_id uuid, access_level text)
    ON CONFLICT (user_id, branch_id) DO UPDATE SET access_level = EXCLUDED.access_level,
      granted_by = EXCLUDED.granted_by, granted_at = now();
  DELETE FROM public.user_branch_access b WHERE b.user_id = p_user_id
    AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(p_branch_access) AS x(branch_id uuid) WHERE x.branch_id = b.branch_id);
  INSERT INTO public.user_access_logs(user_id, user_email, user_name, role, event_type, module, action_details)
  VALUES (auth.uid(), v_actor.email, v_actor.full_name, v_actor.role, 'action', 'User Management',
    jsonb_build_object('action','user_access_updated','target_user_id',p_user_id,
      'old_primary_role',v_target.role,'new_primary_role',p_primary_role,
      'old_role_ids',v_old_roles,'new_role_ids',v_role_ids,
      'sage_agent_mapping_changed',v_target.sage_agent_name IS DISTINCT FROM nullif(btrim(p_sage_agent_name),''))::text);
  RETURN p_user_id;
END; $$;
REVOKE ALL ON FUNCTION public.admin_save_user_access(uuid,text,text,text,text,text,uuid[],jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_user_access(uuid,text,text,text,text,text,uuid[],jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
