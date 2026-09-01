-- Production controls for the PlantControl weighbridge and Sage GRN boundary.
-- Weighbridge tickets stay in MES. A GRN may omit a ticket, but a linked ticket
-- must be a signed, positive-nett, supplier-and-material match.

CREATE OR REPLACE FUNCTION public.has_mes_role(p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = ANY(p_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.has_mes_role(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_mes_role(text[]) TO authenticated, service_role;

CREATE UNIQUE INDEX IF NOT EXISTS uq_grn_weighbridge_ticket
  ON public.goods_received_notes (weigh_bridge_ticket_id)
  WHERE weigh_bridge_ticket_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.approve_grn_and_queue(p_grn_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grn public.goods_received_notes%ROWTYPE;
  v_ticket public.weigh_bridge_tickets%ROWTYPE;
  v_total_lines integer;
  v_matching_lines integer;
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'finance', 'accountant']) THEN
    RAISE EXCEPTION 'Only Finance, Accountant, or Admin users can approve a GRN.';
  END IF;

  SELECT * INTO v_grn
  FROM public.goods_received_notes
  WHERE id = p_grn_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GRN % was not found.', p_grn_id;
  END IF;

  IF v_grn.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending GRNs can be approved.';
  END IF;

  IF v_grn.weigh_bridge_ticket_id IS NOT NULL THEN
    SELECT * INTO v_ticket
    FROM public.weigh_bridge_tickets
    WHERE id = v_grn.weigh_bridge_ticket_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected weighbridge ticket no longer exists.';
    END IF;

    IF v_ticket.status NOT IN ('open', 'linked') THEN
      RAISE EXCEPTION 'Only open weighbridge tickets can be linked to a GRN.';
    END IF;

    IF v_ticket.supplier_id IS DISTINCT FROM v_grn.supplier_id THEN
      RAISE EXCEPTION 'The weighbridge ticket supplier must match the GRN supplier.';
    END IF;

    IF COALESCE(v_ticket.nett_mass, 0) <= 0 OR NOT COALESCE(v_ticket.driver_signed, false) THEN
      RAISE EXCEPTION 'A linked weighbridge ticket requires a positive nett mass and driver sign-off.';
    END IF;

    SELECT
      COUNT(*),
      COUNT(*) FILTER (
        WHERE raw_materials.code = v_ticket.product_code
           OR raw_materials.sage_code = v_ticket.product_code
      )
    INTO v_total_lines, v_matching_lines
    FROM public.grn_items
    JOIN public.raw_materials ON raw_materials.id = grn_items.raw_material_id
    WHERE grn_items.grn_id = v_grn.id;

    IF v_total_lines = 0 OR v_total_lines <> v_matching_lines THEN
      RAISE EXCEPTION 'Every GRN line must match the selected weighbridge ticket material.';
    END IF;
  END IF;

  UPDATE public.goods_received_notes
  SET status = 'approved',
      approved_by = auth.uid(),
      approved_at = now(),
      updated_at = now()
  WHERE id = v_grn.id;

  INSERT INTO public.sync_log (
    event_type,
    reference_type,
    reference_id,
    status,
    description,
    created_at,
    updated_at
  )
  SELECT
    'grn_confirmed',
    'goods_received_notes',
    v_grn.id,
    'pending',
    format('GRN %s approved by Finance', v_grn.grn_number),
    now(),
    now()
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.sync_log
    WHERE event_type = 'grn_confirmed'
      AND reference_type = 'goods_received_notes'
      AND reference_id = v_grn.id
      AND status IN ('pending', 'processing', 'success')
  );

  IF v_grn.weigh_bridge_ticket_id IS NOT NULL THEN
    UPDATE public.weigh_bridge_tickets
    SET status = 'linked',
        updated_at = now()
    WHERE id = v_grn.weigh_bridge_ticket_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_grn(p_grn_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'finance', 'accountant']) THEN
    RAISE EXCEPTION 'Only Finance, Accountant, or Admin users can reject a GRN.';
  END IF;

  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A rejection reason is required.';
  END IF;

  SELECT status INTO v_status
  FROM public.goods_received_notes
  WHERE id = p_grn_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GRN % was not found.', p_grn_id;
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending GRNs can be rejected.';
  END IF;

  UPDATE public.goods_received_notes
  SET status = 'rejected',
      approved_by = auth.uid(),
      approved_at = now(),
      rejection_reason = btrim(p_reason),
      updated_at = now()
  WHERE id = p_grn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_grn_and_queue(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_grn(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_grn_and_queue(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_grn(uuid, text) TO authenticated, service_role;

-- Retire broad browser-write access for the two release-scope workflows.
DROP POLICY IF EXISTS "Authenticated users can insert grn" ON public.goods_received_notes;
DROP POLICY IF EXISTS "Authenticated users can update grn" ON public.goods_received_notes;
DROP POLICY IF EXISTS "Only admin and warehouse_manager can delete grn" ON public.goods_received_notes;
DROP POLICY IF EXISTS "WB tickets insertable by authenticated" ON public.weigh_bridge_tickets;
DROP POLICY IF EXISTS "WB tickets updatable by authenticated" ON public.weigh_bridge_tickets;
DROP POLICY IF EXISTS "Authenticated users can insert grn_items" ON public.grn_items;
DROP POLICY IF EXISTS "Authenticated users can update grn_items" ON public.grn_items;
DROP POLICY IF EXISTS "Authenticated users can delete grn_items" ON public.grn_items;
DROP POLICY IF EXISTS "Only admin and warehouse_manager can delete grn items" ON public.grn_items;

CREATE POLICY "MES operators can create GRN drafts"
  ON public.goods_received_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    received_by = auth.uid()
    AND public.has_mes_role(ARRAY['admin', 'warehouse_manager', 'raw_material_manager', 'rm_manager', 'procurement', 'finance', 'accountant'])
  );

CREATE POLICY "MES operators can add pending GRN items"
  ON public.grn_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.goods_received_notes grn
      WHERE grn.id = grn_items.grn_id
        AND grn.status = 'pending'
        AND public.has_mes_role(ARRAY['admin', 'warehouse_manager', 'raw_material_manager', 'rm_manager', 'procurement', 'finance', 'accountant'])
    )
  );

CREATE POLICY "MES operators can edit pending GRN items"
  ON public.grn_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.goods_received_notes grn
      WHERE grn.id = grn_items.grn_id
        AND grn.status = 'pending'
        AND public.has_mes_role(ARRAY['admin', 'warehouse_manager', 'raw_material_manager', 'rm_manager', 'procurement', 'finance', 'accountant'])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.goods_received_notes grn
      WHERE grn.id = grn_items.grn_id
        AND grn.status = 'pending'
        AND public.has_mes_role(ARRAY['admin', 'warehouse_manager', 'raw_material_manager', 'rm_manager', 'procurement', 'finance', 'accountant'])
    )
  );

CREATE POLICY "MES operators can delete pending GRN items"
  ON public.grn_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.goods_received_notes grn
      WHERE grn.id = grn_items.grn_id
        AND grn.status = 'pending'
        AND public.has_mes_role(ARRAY['admin', 'warehouse_manager', 'raw_material_manager', 'rm_manager', 'procurement', 'finance', 'accountant'])
    )
  );

CREATE POLICY "Weighbridge operators can create their tickets"
  ON public.weigh_bridge_tickets
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.has_mes_role(ARRAY['admin', 'weighbridge', 'weigh_bridge', 'warehouse_manager', 'raw_material_manager', 'rm_manager', 'procurement'])
  );

CREATE POLICY "Weighbridge operators can edit their open tickets"
  ON public.weigh_bridge_tickets
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    AND status = 'open'
    AND public.has_mes_role(ARRAY['admin', 'weighbridge', 'weigh_bridge', 'warehouse_manager', 'raw_material_manager', 'rm_manager', 'procurement'])
  )
  WITH CHECK (
    created_by = auth.uid()
    AND status = 'open'
    AND public.has_mes_role(ARRAY['admin', 'weighbridge', 'weigh_bridge', 'warehouse_manager', 'raw_material_manager', 'rm_manager', 'procurement'])
  );
