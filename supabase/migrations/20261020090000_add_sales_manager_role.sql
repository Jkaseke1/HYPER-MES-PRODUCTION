-- Sales Manager profile for CRM. It only widens the allowed profile role
-- values; no existing approval, posting or stock checks reference it.

DO $$
DECLARE
  allowed_roles text;
BEGIN
  -- Keep every role already in use so the rebuilt constraint never rejects
  -- an existing live profile.
  SELECT string_agg(DISTINCT quote_literal(role_code), ', ' ORDER BY quote_literal(role_code))
  INTO allowed_roles
  FROM (
    SELECT unnest(ARRAY[
      'admin', 'md', 'production_manager', 'supervisor', 'operator',
      'warehouse_manager', 'warehouse_clerk', 'raw_material_manager', 'rm_manager',
      'finance', 'finance_viewer', 'accountant', 'logistics', 'weighbridge', 'weigh_bridge',
      'procurement', 'quality_controller', 'maintenance_tech', 'chick_manager',
      'driver', 'branch_manager', 'production_receiver', 'viewer', 'sales_manager'
    ]) AS role_code
    UNION
    SELECT DISTINCT role FROM public.profiles WHERE role IS NOT NULL
  ) AS roles;

  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
  EXECUTE format(
    'ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN (%s))',
    allowed_roles
  );
END $$;

INSERT INTO public.roles (code, name, description, is_system, is_active)
VALUES (
  'sales_manager',
  'Sales Manager',
  'CRM customers, pipeline, follow-ups and sales reporting. No stock, GRN, production or Sage posting rights.',
  true,
  true
)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = true,
    updated_at = now();

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM public.roles AS role
JOIN public.permissions AS permission ON permission.code IN (
  'dashboard.view',
  'sales.view',
  'sales.create',
  'sales.edit',
  'dispatch.view',
  'reports.view',
  'reports.export'
)
WHERE role.code = 'sales_manager'
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
