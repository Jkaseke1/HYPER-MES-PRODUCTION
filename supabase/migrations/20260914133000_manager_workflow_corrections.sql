-- Manager-only corrections for inbound tickets and GRNs.
-- Initiators/operators retain capture rights but cannot rewrite their own records.

DROP POLICY IF EXISTS "Weighbridge managers can correct tickets" ON public.weigh_bridge_tickets;
DROP POLICY IF EXISTS "Weighbridge managers can delete open tickets" ON public.weigh_bridge_tickets;

CREATE POLICY "Weighbridge managers can correct tickets"
  ON public.weigh_bridge_tickets
  FOR UPDATE TO authenticated
  USING (
    status IN ('open', 'in_grn')
    AND public.has_mes_role(ARRAY[
      'admin', 'raw_material_manager', 'rm_manager', 'warehouse_manager', 'production_manager'
    ])
  )
  WITH CHECK (
    status IN ('open', 'in_grn')
    AND public.has_mes_role(ARRAY[
      'admin', 'raw_material_manager', 'rm_manager', 'warehouse_manager', 'production_manager'
    ])
  );

CREATE POLICY "Weighbridge managers can delete open tickets"
  ON public.weigh_bridge_tickets
  FOR DELETE TO authenticated
  USING (
    status = 'open'
    AND public.has_mes_role(ARRAY[
      'admin', 'raw_material_manager', 'rm_manager', 'warehouse_manager', 'production_manager'
    ])
    AND NOT EXISTS (
      SELECT 1 FROM public.goods_received_notes grn
      WHERE grn.weigh_bridge_ticket_id = weigh_bridge_tickets.id
    )
  );

ALTER TABLE public.goods_received_notes
  ADD COLUMN IF NOT EXISTS manual_grv_number text;

COMMENT ON COLUMN public.goods_received_notes.manual_grv_number IS
  'Mandatory supplier/manual GRV reference captured during receipt; replaces the free-text Delivery Notes field.';

DROP POLICY IF EXISTS "Managers can correct GRN headers" ON public.goods_received_notes;
CREATE POLICY "Managers can correct GRN headers"
  ON public.goods_received_notes
  FOR UPDATE TO authenticated
  USING (
    status IN ('pending', 'pending_costing', 'pending_finance')
    AND public.has_mes_role(ARRAY[
      'admin', 'raw_material_manager', 'rm_manager', 'warehouse_manager', 'production_manager'
    ])
  )
  WITH CHECK (
    status IN ('pending', 'pending_costing', 'pending_finance')
    AND public.has_mes_role(ARRAY[
      'admin', 'raw_material_manager', 'rm_manager', 'warehouse_manager', 'production_manager'
    ])
  );

DROP POLICY IF EXISTS "Managers can correct GRN items" ON public.grn_items;
CREATE POLICY "Managers can correct GRN items"
  ON public.grn_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.goods_received_notes grn
      WHERE grn.id = grn_items.grn_id
        AND grn.status IN ('pending', 'pending_costing', 'pending_finance')
        AND public.has_mes_role(ARRAY[
          'admin', 'raw_material_manager', 'rm_manager', 'warehouse_manager', 'production_manager'
        ])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.goods_received_notes grn
      WHERE grn.id = grn_items.grn_id
        AND grn.status IN ('pending', 'pending_costing', 'pending_finance')
        AND public.has_mes_role(ARRAY[
          'admin', 'raw_material_manager', 'rm_manager', 'warehouse_manager', 'production_manager'
        ])
    )
  );
