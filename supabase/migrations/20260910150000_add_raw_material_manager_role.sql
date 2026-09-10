-- Raw Materials Manager role for RM operations and GRN costing handoff.
-- Finance approval remains restricted to Finance/Admin approval workflow.

INSERT INTO public.roles (code, name, description, is_system, is_active)
VALUES ('raw_material_manager', 'Raw Materials Manager',
        'Manages raw materials, GRNs, RM transfers, and enters GRN costing before Finance approval',
        true, true)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = true,
    updated_at = now();

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN (
  'dashboard.view',
  'raw_materials.view', 'raw_materials.create', 'raw_materials.edit',
  'grn.view', 'grn.create',
  'warehouse.view', 'warehouse.transfer',
  'reports.view'
)
WHERE r.code = 'raw_material_manager'
ON CONFLICT DO NOTHING;
