-- Controlled weighbridge corrections for Admin and Raw Materials Manager.
-- Linked/cancelled tickets remain immutable for audit integrity.

DROP POLICY IF EXISTS "WB tickets updatable by authenticated" ON public.weigh_bridge_tickets;
DROP POLICY IF EXISTS "Weighbridge operators can edit their open tickets" ON public.weigh_bridge_tickets;
DROP POLICY IF EXISTS "Weighbridge managers can correct tickets" ON public.weigh_bridge_tickets;
DROP POLICY IF EXISTS "Weighbridge managers can delete open tickets" ON public.weigh_bridge_tickets;

CREATE POLICY "Weighbridge managers can correct tickets"
  ON public.weigh_bridge_tickets
  FOR UPDATE TO authenticated
  USING (
    status = 'open'
    AND public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager'])
  )
  WITH CHECK (
    status = 'open'
    AND public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager'])
  );

CREATE POLICY "Weighbridge managers can delete open tickets"
  ON public.weigh_bridge_tickets
  FOR DELETE TO authenticated
  USING (
    status = 'open'
    AND public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager'])
    AND NOT EXISTS (
      SELECT 1
      FROM public.goods_received_notes grn
      WHERE grn.weigh_bridge_ticket_id = weigh_bridge_tickets.id
    )
  );
