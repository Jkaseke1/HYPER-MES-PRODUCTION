-- Keep the PlantControl workflow ledger aligned with approved GRNs.
-- Sage stock remains the external source of truth; this ledger is used for
-- reservations and the RM -> BUFFER -> PRODUCTION workflow.

CREATE OR REPLACE FUNCTION public.sync_approved_grn_to_workflow(
  p_grn_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grn public.goods_received_notes%ROWTYPE;
  v_item record;
  v_existing_quantity numeric;
  v_processed_lines integer := 0;
BEGIN
  SELECT * INTO v_grn
  FROM public.goods_received_notes
  WHERE id = p_grn_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GRN % was not found.', p_grn_id;
  END IF;

  IF v_grn.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved GRNs can update the workflow ledger. Current status: %', v_grn.status;
  END IF;

  IF v_grn.warehouse_id IS NULL THEN
    RAISE EXCEPTION 'GRN % has no receiving warehouse.', v_grn.grn_number;
  END IF;

  FOR v_item IN
    SELECT gi.raw_material_id, gi.received_qty, rm.unit, gi.batch_number
    FROM public.grn_items gi
    JOIN public.raw_materials rm ON rm.id = gi.raw_material_id
    WHERE gi.grn_id = p_grn_id
      AND COALESCE(gi.received_qty, 0) > 0
  LOOP
    -- This is the idempotency guard. A repeated repair or approval retry
    -- cannot add the same GRN line twice.
    IF EXISTS (
      SELECT 1
      FROM public.stock_movements sm
      WHERE sm.reference_type = 'goods_received_notes'
        AND sm.reference_id = p_grn_id
        AND sm.raw_material_id = v_item.raw_material_id
        AND sm.movement_type = 'receipt'
    ) THEN
      CONTINUE;
    END IF;

    UPDATE public.warehouse_stock_balances
    SET quantity = quantity + v_item.received_qty,
        updated_at = now()
    WHERE raw_material_id = v_item.raw_material_id
      AND warehouse_id = v_grn.warehouse_id
    RETURNING quantity INTO v_existing_quantity;

    IF NOT FOUND THEN
      INSERT INTO public.warehouse_stock_balances (
        raw_material_id, warehouse_id, quantity, updated_at
      ) VALUES (
        v_item.raw_material_id, v_grn.warehouse_id, v_item.received_qty, now()
      );
    END IF;

    INSERT INTO public.stock_movements (
      movement_type, reference_type, reference_id, raw_material_id,
      warehouse_id, quantity, unit, batch_number, movement_date,
      performed_by, notes
    ) VALUES (
      'receipt', 'goods_received_notes', p_grn_id, v_item.raw_material_id,
      v_grn.warehouse_id, v_item.received_qty, COALESCE(NULLIF(v_item.unit, ''), 'kg'),
      COALESCE(v_item.batch_number, ''), now(),
      COALESCE(v_grn.approved_by, v_grn.received_by),
      format('GRN %s approved receipt; synchronized to PlantControl workflow ledger', v_grn.grn_number)
    );

    v_processed_lines := v_processed_lines + 1;
  END LOOP;

  RETURN v_processed_lines;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_approved_grn_to_workflow(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_approved_grn_to_workflow(uuid) TO service_role;

-- All normal Finance approvals already use this RPC. Replacing it here makes
-- the workflow-ledger update part of the same transaction as GRN approval.
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

    SELECT COUNT(*), COUNT(*) FILTER (
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
  SET status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
  WHERE id = v_grn.id;

  PERFORM public.sync_approved_grn_to_workflow(v_grn.id);

  INSERT INTO public.sync_log (
    event_type, reference_type, reference_id, status, description, created_at, updated_at
  )
  SELECT 'grn_confirmed', 'goods_received_notes', v_grn.id, 'pending',
         format('GRN %s approved by Finance', v_grn.grn_number), now(), now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.sync_log
    WHERE event_type = 'grn_confirmed'
      AND reference_type = 'goods_received_notes'
      AND reference_id = v_grn.id
      AND status IN ('pending', 'processing', 'success')
  );

  IF v_grn.weigh_bridge_ticket_id IS NOT NULL THEN
    UPDATE public.weigh_bridge_tickets
    SET status = 'linked', updated_at = now()
    WHERE id = v_grn.weigh_bridge_ticket_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_grn_and_queue(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_grn_and_queue(uuid) TO authenticated, service_role;
