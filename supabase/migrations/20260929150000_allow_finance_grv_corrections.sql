-- Finance may correct a GRV before final approval. Approved and rejected GRVs
-- remain locked so Sage-posted receipts and their audit history cannot be changed.

INSERT INTO public.permissions (code, name, description, module)
VALUES ('grn.edit', 'Edit GRV', 'Correct a GRV before final approval', 'grn')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    module = EXCLUDED.module;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM public.roles AS role
JOIN public.permissions AS permission ON permission.code = 'grn.edit'
WHERE role.code IN (
  'admin', 'finance', 'accountant',
  'raw_material_manager', 'rm_manager', 'warehouse_manager', 'production_manager'
)
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS "Weighbridge managers can correct tickets" ON public.weigh_bridge_tickets;
CREATE POLICY "Finance and managers can correct pre-approval tickets"
  ON public.weigh_bridge_tickets
  FOR UPDATE TO authenticated
  USING (
    status IN ('open', 'in_grn')
    AND public.has_mes_role(ARRAY[
      'admin', 'finance', 'accountant',
      'raw_material_manager', 'rm_manager', 'warehouse_manager', 'production_manager'
    ])
  )
  WITH CHECK (
    status IN ('open', 'in_grn')
    AND public.has_mes_role(ARRAY[
      'admin', 'finance', 'accountant',
      'raw_material_manager', 'rm_manager', 'warehouse_manager', 'production_manager'
    ])
  );

DROP POLICY IF EXISTS "Managers can correct GRN headers" ON public.goods_received_notes;
CREATE POLICY "Finance and managers can correct pre-approval GRN headers"
  ON public.goods_received_notes
  FOR UPDATE TO authenticated
  USING (
    status IN ('pending', 'pending_costing', 'pending_finance')
    AND public.has_mes_role(ARRAY[
      'admin', 'finance', 'accountant',
      'raw_material_manager', 'rm_manager', 'warehouse_manager', 'production_manager'
    ])
  )
  WITH CHECK (
    status IN ('pending', 'pending_costing', 'pending_finance')
    AND public.has_mes_role(ARRAY[
      'admin', 'finance', 'accountant',
      'raw_material_manager', 'rm_manager', 'warehouse_manager', 'production_manager'
    ])
  );

DROP POLICY IF EXISTS "Managers can correct GRN items" ON public.grn_items;
CREATE POLICY "Finance and managers can correct pre-approval GRN items"
  ON public.grn_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.goods_received_notes AS grn
      WHERE grn.id = grn_items.grn_id
        AND grn.status IN ('pending', 'pending_costing', 'pending_finance')
        AND public.has_mes_role(ARRAY[
          'admin', 'finance', 'accountant',
          'raw_material_manager', 'rm_manager', 'warehouse_manager', 'production_manager'
        ])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.goods_received_notes AS grn
      WHERE grn.id = grn_items.grn_id
        AND grn.status IN ('pending', 'pending_costing', 'pending_finance')
        AND public.has_mes_role(ARRAY[
          'admin', 'finance', 'accountant',
          'raw_material_manager', 'rm_manager', 'warehouse_manager', 'production_manager'
        ])
    )
  );
