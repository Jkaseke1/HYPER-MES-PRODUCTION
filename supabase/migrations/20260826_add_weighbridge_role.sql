-- Add a dedicated Weighbridge role and retain all roles already used by HYPER MES.
DO $$
DECLARE
  profile_role_constraint text;
BEGIN
  SELECT conname INTO profile_role_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.profiles'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%production_manager%'
  LIMIT 1;

  IF profile_role_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', profile_role_constraint);
  END IF;
END $$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN (
    'admin', 'md', 'production_manager', 'supervisor', 'operator',
    'warehouse_manager', 'raw_material_manager', 'rm_manager', 'finance',
    'accountant', 'logistics', 'weighbridge', 'weigh_bridge', 'procurement',
    'quality_controller', 'maintenance_tech', 'chick_manager', 'driver',
    'branch_manager', 'viewer'
  ));

INSERT INTO public.roles (code, name, description, is_system, is_active)
VALUES ('weighbridge', 'Weighbridge Operator', 'Captures and manages weighbridge tickets only', true, true)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = true,
    updated_at = now();
