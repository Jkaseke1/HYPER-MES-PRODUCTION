-- Read-only finance profile. This is intentionally a separate role from
-- finance/accountant so no existing approval or posting checks are widened.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN (
    'admin', 'md', 'production_manager', 'supervisor', 'operator',
    'warehouse_manager', 'warehouse_clerk', 'raw_material_manager', 'rm_manager',
    'finance', 'finance_viewer', 'accountant', 'logistics', 'weighbridge', 'weigh_bridge',
    'procurement', 'quality_controller', 'maintenance_tech', 'chick_manager',
    'driver', 'branch_manager', 'production_receiver', 'viewer'
  ));

INSERT INTO public.roles (code, name, description, is_system, is_active)
VALUES (
  'finance_viewer',
  'Finance Viewer',
  'Read-only finance visibility. Cannot create, edit, approve, post, retry, reverse, transfer, or adjust records.',
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
  'raw_materials.view',
  'grn.view',
  'quality.view',
  'formulations.view',
  'planning.view',
  'production.view',
  'warehouse.view',
  'dispatch.view',
  'sales.view',
  'maintenance.view',
  'spare_parts.view',
  'reports.view',
  'reports.export',
  'reconciliation.view'
)
WHERE role.code = 'finance_viewer'
ON CONFLICT DO NOTHING;
