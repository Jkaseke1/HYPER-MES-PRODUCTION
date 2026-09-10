-- Warehouse Clerk inventory scope: Weighbridge, GRN, RM Warehouse, and transfers.

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN (
  'dashboard.view', 'raw_materials.view', 'grn.view', 'grn.create',
  'warehouse.view', 'warehouse.transfer'
)
WHERE r.code = 'warehouse_clerk'
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS "Weighbridge operators can create their tickets" ON public.weigh_bridge_tickets;
CREATE POLICY "Weighbridge operators can create their tickets"
  ON public.weigh_bridge_tickets FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.has_mes_role(ARRAY[
      'admin', 'weighbridge', 'weigh_bridge', 'warehouse_clerk',
      'warehouse_manager', 'raw_material_manager', 'rm_manager', 'procurement'
    ])
  );

DROP POLICY IF EXISTS "Weighbridge operators can edit their open tickets" ON public.weigh_bridge_tickets;
CREATE POLICY "Weighbridge operators can edit their open tickets"
  ON public.weigh_bridge_tickets FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    AND status = 'open'
    AND public.has_mes_role(ARRAY[
      'admin', 'weighbridge', 'weigh_bridge', 'warehouse_clerk',
      'warehouse_manager', 'raw_material_manager', 'rm_manager', 'procurement'
    ])
  )
  WITH CHECK (
    created_by = auth.uid()
    AND status = 'open'
    AND public.has_mes_role(ARRAY[
      'admin', 'weighbridge', 'weigh_bridge', 'warehouse_clerk',
      'warehouse_manager', 'raw_material_manager', 'rm_manager', 'procurement'
    ])
  );
