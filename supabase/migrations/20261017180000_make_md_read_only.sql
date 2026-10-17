-- Apply during an approved maintenance window. Does not rewrite business data.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.is_md_read_only()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.role() = 'service_role' THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'md');
END;
$$;
REVOKE ALL ON FUNCTION public.is_md_read_only() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_md_read_only() TO authenticated, service_role;

-- This also protects writes inside SECURITY DEFINER workflow functions.
CREATE OR REPLACE FUNCTION public.guard_md_read_only_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF public.is_md_read_only() THEN
    -- Automatic access auditing is not an operational edit. Only append own events.
    IF TG_TABLE_SCHEMA = 'public' AND TG_TABLE_NAME = 'user_access_logs' AND TG_OP = 'INSERT' THEN
      IF NEW.user_id = auth.uid() AND NEW.event_type IN ('login', 'logout', 'page_view') THEN RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION 'Managing Director access is read-only.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'TRUNCATE' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_md_read_only_write() FROM PUBLIC;

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.relname, c.relrowsecurity
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS guard_md_read_only_write ON public.%I', t.relname);
    EXECUTE format('CREATE TRIGGER guard_md_read_only_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_md_read_only_write()', t.relname);
    EXECUTE format('DROP TRIGGER IF EXISTS guard_md_read_only_truncate ON public.%I', t.relname);
    EXECUTE format('CREATE TRIGGER guard_md_read_only_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.guard_md_read_only_write()', t.relname);
    IF t.relrowsecurity THEN
      EXECUTE format('DROP POLICY IF EXISTS md_read_all ON public.%I', t.relname);
      EXECUTE format('CREATE POLICY md_read_all ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_md_read_only()))', t.relname);
    END IF;
  END LOOP;
END;
$$;

-- Refuse mutating RPC calls before sequences or side effects can run.
-- Do not silently overwrite an existing request hook.
CREATE OR REPLACE FUNCTION public.enforce_md_read_only_request()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  method text := current_setting('request.method', true);
  path text := current_setting('request.path', true);
BEGIN
  IF NOT public.is_md_read_only() THEN RETURN; END IF;
  IF path LIKE '/rpc/%' THEN
    IF path IN ('/rpc/grn_input_allowed', '/rpc/list_inbound_transporters_for_weighbridge') THEN RETURN; END IF;
  ELSIF method IN ('GET', 'HEAD', 'OPTIONS') THEN
    RETURN;
  ELSIF method = 'POST' AND path = '/user_access_logs' THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'Managing Director access is read-only.' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_md_read_only_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_md_read_only_request() TO anon, authenticated, service_role;

DO $$
DECLARE setting text;
BEGIN
  SELECT cfg INTO setting FROM pg_db_role_setting s
  JOIN pg_roles r ON r.oid = s.setrole
  CROSS JOIN LATERAL unnest(s.setconfig) cfg
  WHERE r.rolname = 'authenticator' AND cfg LIKE 'pgrst.db_pre_request=%'
    AND cfg NOT IN ('pgrst.db_pre_request=', 'pgrst.db_pre_request=public.enforce_md_read_only_request')
  LIMIT 1;
  IF setting IS NOT NULL THEN
    RAISE EXCEPTION 'Existing PostgREST request hook detected. Review and compose it before deploying MD controls.';
  END IF;
END;
$$;
ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.enforce_md_read_only_request';

-- Attachments remain readable, but MD cannot upload, replace or delete files.
DROP POLICY IF EXISTS md_read_attachments ON storage.objects;
CREATE POLICY md_read_attachments ON storage.objects FOR SELECT TO authenticated
USING ((SELECT public.is_md_read_only()));
DROP POLICY IF EXISTS md_no_storage_insert ON storage.objects;
CREATE POLICY md_no_storage_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (NOT (SELECT public.is_md_read_only()));
DROP POLICY IF EXISTS md_no_storage_update ON storage.objects;
CREATE POLICY md_no_storage_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
USING (NOT (SELECT public.is_md_read_only())) WITH CHECK (NOT (SELECT public.is_md_read_only()));
DROP POLICY IF EXISTS md_no_storage_delete ON storage.objects;
CREATE POLICY md_no_storage_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
USING (NOT (SELECT public.is_md_read_only()));

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
COMMIT;
