-- Warehouse Clerk: GRN capture, RM-to-buffer transfers, and RM Warehouse access.
-- Costing, Finance approval, Production receiving, and stock adjustment remain restricted.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN (
    'admin', 'md', 'production_manager', 'supervisor', 'operator',
    'warehouse_manager', 'warehouse_clerk', 'raw_material_manager', 'rm_manager',
    'finance', 'accountant', 'logistics', 'weighbridge', 'weigh_bridge',
    'procurement', 'quality_controller', 'maintenance_tech', 'chick_manager',
    'driver', 'branch_manager', 'production_receiver', 'viewer'
  ));

INSERT INTO public.roles (code, name, description, is_system, is_active)
VALUES ('warehouse_clerk', 'Warehouse Clerk',
        'Captures GRNs, creates RM-to-buffer transfers, and views the RM Warehouse',
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
  'dashboard.view', 'raw_materials.view', 'grn.view', 'grn.create',
  'warehouse.view', 'warehouse.transfer'
)
WHERE r.code = 'warehouse_clerk'
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS "MES operators can create GRN drafts" ON public.goods_received_notes;
CREATE POLICY "MES operators can create GRN drafts"
  ON public.goods_received_notes FOR INSERT TO authenticated
  WITH CHECK (
    received_by = auth.uid()
    AND public.has_mes_role(ARRAY[
      'admin', 'warehouse_manager', 'warehouse_clerk', 'raw_material_manager',
      'rm_manager', 'procurement', 'finance', 'accountant'
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
          'admin', 'warehouse_manager', 'warehouse_clerk', 'raw_material_manager',
          'rm_manager', 'procurement', 'finance', 'accountant'
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
          'admin', 'warehouse_manager', 'warehouse_clerk', 'raw_material_manager',
          'rm_manager', 'procurement', 'finance', 'accountant'
        ])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.goods_received_notes grn
      WHERE grn.id = grn_items.grn_id
        AND grn.status IN ('pending', 'pending_costing')
        AND public.has_mes_role(ARRAY[
          'admin', 'warehouse_manager', 'warehouse_clerk', 'raw_material_manager',
          'rm_manager', 'procurement', 'finance', 'accountant'
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
          'admin', 'warehouse_manager', 'warehouse_clerk', 'raw_material_manager',
          'rm_manager', 'procurement', 'finance', 'accountant'
        ])
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_material_transfer_request_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> NEW.requested_by THEN
    RAISE EXCEPTION 'Authenticated user must request the transfer';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'md', 'production_manager', 'supervisor',
                   'warehouse_manager', 'warehouse_clerk', 'raw_material_manager',
                   'rm_manager', 'logistics')
  ) THEN
    RAISE EXCEPTION 'This role cannot create material transfers';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_material_transfer_to_buffer(
  p_raw_material_id uuid, p_from_warehouse_id uuid, p_quantity numeric,
  p_unit text, p_transfer_date date, p_purpose text, p_notes text,
  p_production_order_id uuid, p_requested_by uuid
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_transfer_id uuid;
  v_buffer_warehouse_id uuid;
  v_rm_balance numeric;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_requested_by THEN
    RAISE EXCEPTION 'Authenticated user must request the transfer';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Transfer quantity must be greater than zero';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'md', 'production_manager', 'supervisor',
                   'warehouse_manager', 'warehouse_clerk', 'raw_material_manager',
                   'rm_manager', 'logistics')
  ) THEN
    RAISE EXCEPTION 'This role cannot create material transfers';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses
    WHERE id = p_from_warehouse_id AND upper(code) = 'RM' AND is_active
  ) THEN
    RAISE EXCEPTION 'Transfers must originate from the active RM warehouse';
  END IF;
  SELECT id INTO v_buffer_warehouse_id FROM public.warehouses
  WHERE upper(code) = 'BUFFER' AND is_active LIMIT 1;
  IF v_buffer_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Active BUFFER warehouse not found';
  END IF;
  SELECT COALESCE(quantity, 0) INTO v_rm_balance
  FROM public.warehouse_stock_balances
  WHERE raw_material_id = p_raw_material_id
    AND warehouse_id = p_from_warehouse_id FOR UPDATE;
  IF COALESCE(v_rm_balance, 0) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock in RM Warehouse. Available: %, Required: %',
      COALESCE(v_rm_balance, 0), p_quantity;
  END IF;
  PERFORM public.update_warehouse_balance(p_raw_material_id, p_from_warehouse_id, -p_quantity);
  PERFORM public.update_warehouse_balance(p_raw_material_id, v_buffer_warehouse_id, p_quantity);
  INSERT INTO public.material_transfers (
    raw_material_id, from_warehouse_id, buffer_warehouse_id, quantity, unit,
    transfer_date, purpose, notes, production_order_id, status,
    requested_by, buffer_approved_by, buffer_approved_at
  ) VALUES (
    p_raw_material_id, p_from_warehouse_id, v_buffer_warehouse_id, p_quantity,
    COALESCE(NULLIF(p_unit, ''), 'kg'), COALESCE(p_transfer_date, CURRENT_DATE),
    COALESCE(p_purpose, ''), COALESCE(p_notes, ''), p_production_order_id,
    'in_buffer', p_requested_by, p_requested_by, now()
  ) RETURNING id INTO v_transfer_id;
  INSERT INTO public.stock_movements (
    movement_type, reference_type, reference_id, raw_material_id, warehouse_id,
    quantity, unit, movement_date, performed_by, notes
  ) VALUES (
    'transfer', 'material_transfer', v_transfer_id, p_raw_material_id,
    v_buffer_warehouse_id, p_quantity, COALESCE(NULLIF(p_unit, ''), 'kg'),
    now(), p_requested_by, 'Step 1: RM to Production Buffer'
  );
  RETURN v_transfer_id;
END;
$$;
