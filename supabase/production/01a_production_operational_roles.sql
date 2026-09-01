-- Production-only operational role configuration.
-- Safe on an empty database: config rows only; no users or business records.

INSERT INTO public.roles (code, name, description, is_system, is_active)
VALUES
  ('md', 'Managing Director', 'Executive access across PlantControl', true, true),
  ('procurement', 'Procurement', 'Supplier, GRN, and purchasing operations', true, true),
  ('logistics', 'Logistics', 'Dispatch, warehouse, and GRN operations', true, true)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = true,
    updated_at = now();

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code = 'md'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code = ANY (ARRAY[
  'dashboard.view', 'raw_materials.view', 'grn.view', 'production.view',
  'dispatch.view', 'sales.view', 'reports.view', 'reports.export',
  'reconciliation.view', 'reconciliation.create'
])
WHERE r.code = 'finance'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code = ANY (ARRAY[
  'dashboard.view', 'raw_materials.view', 'raw_materials.create',
  'raw_materials.edit', 'grn.view', 'grn.create', 'warehouse.view',
  'reports.view', 'reports.export'
])
WHERE r.code = 'procurement'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code = ANY (ARRAY[
  'dashboard.view', 'raw_materials.view', 'grn.view', 'grn.create',
  'warehouse.view', 'warehouse.transfer', 'dispatch.view',
  'dispatch.create', 'dispatch.approve', 'reports.view', 'reports.export'
])
WHERE r.code = 'logistics'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code = ANY (ARRAY[
  'dashboard.view', 'raw_materials.view', 'grn.view', 'grn.create',
  'warehouse.view', 'reports.view'
])
WHERE r.code = 'weighbridge'
ON CONFLICT DO NOTHING;

SELECT code, name
FROM public.roles
WHERE code IN ('admin', 'md', 'production_manager', 'warehouse_manager',
  'finance', 'procurement', 'logistics', 'weighbridge')
ORDER BY code;
