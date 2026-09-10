-- Weighbridge Operators may capture GRNs, create RM-to-buffer transfers,
-- and view the RM Warehouse. They cannot cost, approve, or receive transfers.

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN (
  'dashboard.view', 'raw_materials.view', 'grn.view', 'grn.create',
  'warehouse.view', 'warehouse.transfer'
)
WHERE r.code = 'weighbridge'
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS "MES operators can create GRN drafts" ON public.goods_received_notes;
CREATE POLICY "MES operators can create GRN drafts"
  ON public.goods_received_notes FOR INSERT TO authenticated
  WITH CHECK (
    received_by = auth.uid()
    AND public.has_mes_role(ARRAY[
      'admin', 'warehouse_manager', 'warehouse_clerk', 'weighbridge',
      'raw_material_manager', 'rm_manager', 'procurement', 'finance', 'accountant'
    ])
  );

DROP POLICY IF EXISTS "MES operators can add pending GRN items" ON public.grn_items;
CREATE POLICY "MES operators can add pending GRN items"
  ON public.grn_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.goods_received_notes grn
      WHERE grn.id = grn_items.grn_id
        AND grn.status IN ('pending', 'pending_costing')
        AND public.has_mes_role(ARRAY[
          'admin', 'warehouse_manager', 'warehouse_clerk', 'weighbridge',
          'raw_material_manager', 'rm_manager', 'procurement', 'finance', 'accountant'
        ])
    )
  );

DROP POLICY IF EXISTS "MES operators can edit pending GRN items" ON public.grn_items;
CREATE POLICY "MES operators can edit pending GRN items"
  ON public.grn_items FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.goods_received_notes grn
      WHERE grn.id = grn_items.grn_id
        AND grn.status IN ('pending', 'pending_costing')
        AND public.has_mes_role(ARRAY[
          'admin', 'warehouse_manager', 'warehouse_clerk', 'weighbridge',
          'raw_material_manager', 'rm_manager', 'procurement', 'finance', 'accountant'
        ])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.goods_received_notes grn
      WHERE grn.id = grn_items.grn_id
        AND grn.status IN ('pending', 'pending_costing')
        AND public.has_mes_role(ARRAY[
          'admin', 'warehouse_manager', 'warehouse_clerk', 'weighbridge',
          'raw_material_manager', 'rm_manager', 'procurement', 'finance', 'accountant'
        ])
    )
  );

DROP POLICY IF EXISTS "MES operators can delete pending GRN items" ON public.grn_items;
CREATE POLICY "MES operators can delete pending GRN items"
  ON public.grn_items FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.goods_received_notes grn
      WHERE grn.id = grn_items.grn_id
        AND grn.status IN ('pending', 'pending_costing')
        AND public.has_mes_role(ARRAY[
          'admin', 'warehouse_manager', 'warehouse_clerk', 'weighbridge',
          'raw_material_manager', 'rm_manager', 'procurement', 'finance', 'accountant'
        ])
    )
  );

-- Add weighbridge to the existing RM-to-buffer creator functions without
-- changing their stock, idempotency, or approval logic.
DO $$
DECLARE
  v_sql text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_sql
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'enforce_material_transfer_request_role'
    AND pg_get_function_identity_arguments(p.oid) = '';
  IF v_sql IS NOT NULL THEN
    v_sql := replace(v_sql, '''rm_manager'', ''logistics'')',
                     '''rm_manager'', ''logistics'', ''weighbridge'')');
    EXECUTE v_sql;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_sql
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'create_material_transfer_to_buffer'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_raw_material_id uuid, p_from_warehouse_id uuid, p_quantity numeric, p_unit text, p_transfer_date date, p_purpose text, p_notes text, p_production_order_id uuid, p_requested_by uuid';
  IF v_sql IS NOT NULL THEN
    v_sql := replace(v_sql, '''rm_manager'', ''logistics'')',
                     '''rm_manager'', ''logistics'', ''weighbridge'')');
    EXECUTE v_sql;
  END IF;
END $$;
