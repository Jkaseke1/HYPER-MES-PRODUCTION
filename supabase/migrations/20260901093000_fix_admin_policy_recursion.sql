-- Production authorization repair: avoid recursive RLS policy evaluation.
-- This migration changes policy evaluation only. It does not insert, update,
-- or delete any business, Sage, stock, GRN, or test data.

CREATE OR REPLACE FUNCTION public.has_active_admin_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND r.code = 'admin'
      AND r.is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.has_active_admin_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_active_admin_role() TO authenticated;

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;

CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.has_active_admin_role());

CREATE POLICY "Admins can update all profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_active_admin_role())
  WITH CHECK (public.has_active_admin_role());

CREATE POLICY "Admins can insert profiles" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_active_admin_role());

CREATE POLICY "Admins can delete profiles" ON public.profiles
  FOR DELETE TO authenticated
  USING (public.has_active_admin_role());

DROP POLICY IF EXISTS "Admins can view all user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage all user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update all user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete all user roles" ON public.user_roles;

CREATE POLICY "Admins can view all user roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.has_active_admin_role());

CREATE POLICY "Admins can manage all user roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_active_admin_role());

CREATE POLICY "Admins can update all user roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.has_active_admin_role())
  WITH CHECK (public.has_active_admin_role());

CREATE POLICY "Admins can delete all user roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.has_active_admin_role());

DROP POLICY IF EXISTS "Admins can view all branch access" ON public.user_branch_access;
DROP POLICY IF EXISTS "Admins can manage all branch access" ON public.user_branch_access;
DROP POLICY IF EXISTS "Admins can update all branch access" ON public.user_branch_access;
DROP POLICY IF EXISTS "Admins can delete all branch access" ON public.user_branch_access;

CREATE POLICY "Admins can view all branch access" ON public.user_branch_access
  FOR SELECT TO authenticated
  USING (public.has_active_admin_role());

CREATE POLICY "Admins can manage all branch access" ON public.user_branch_access
  FOR INSERT TO authenticated
  WITH CHECK (public.has_active_admin_role());

CREATE POLICY "Admins can update all branch access" ON public.user_branch_access
  FOR UPDATE TO authenticated
  USING (public.has_active_admin_role())
  WITH CHECK (public.has_active_admin_role());

CREATE POLICY "Admins can delete all branch access" ON public.user_branch_access
  FOR DELETE TO authenticated
  USING (public.has_active_admin_role());
