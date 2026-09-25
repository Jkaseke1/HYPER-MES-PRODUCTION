-- Production rollout: Finance-controlled Return to Supplier workflow.
-- The original GRN stays immutable. An RTS is a separate, auditable document.
-- Retains every existing sync_log event type, including legacy supplier_return.

ALTER TABLE public.sync_log
  DROP CONSTRAINT IF EXISTS sync_log_event_type_check;

ALTER TABLE public.sync_log
  ADD CONSTRAINT sync_log_event_type_check
  CHECK (event_type IN (
    'grn_confirmed', 'supplier_return', 'materials_issued', 'production_completed',
    'dispatch_delivered', 'price_sync', 'customer_sync', 'error',
    'material_variance_alert', 'macropack_manufactured',
    'reconciliation_variance_approved', 'rm_cost_updated',
    'reconciliation_completed', 'material_transfer_to_production',
    'finished_goods_transfer_to_dispatch', 'stock_take_sage_snapshot',
    'sage_stock_refresh', 'return_to_supplier_requested'
  )) NOT VALID;

CREATE TABLE IF NOT EXISTS public.return_to_supplier_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rts_number text UNIQUE NOT NULL,
  original_grn_id uuid NOT NULL REFERENCES public.goods_received_notes(id),
  original_grn_number text NOT NULL,
  supplier_id uuid REFERENCES public.suppliers(id),
  warehouse_id uuid REFERENCES public.warehouses(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending_finance'
    CHECK (status IN ('pending_finance', 'approved', 'processing', 'posted', 'failed', 'cancelled')),
  sage_rts_number text,
  created_by uuid REFERENCES public.profiles(id),
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.return_to_supplier_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rts_id uuid NOT NULL REFERENCES public.return_to_supplier_requests(id) ON DELETE CASCADE,
  grn_item_id uuid NOT NULL REFERENCES public.grn_items(id),
  raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_cost numeric NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  batch_number text,
  expiry_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rts_id, grn_item_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rts_open_grn
  ON public.return_to_supplier_requests (original_grn_id)
  WHERE status IN ('pending_finance', 'approved', 'processing', 'posted');

ALTER TABLE public.return_to_supplier_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_to_supplier_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance can read RTS" ON public.return_to_supplier_requests;
CREATE POLICY "Finance can read RTS" ON public.return_to_supplier_requests
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'finance')
  ));

DROP POLICY IF EXISTS "Finance can read RTS items" ON public.return_to_supplier_items;
CREATE POLICY "Finance can read RTS items" ON public.return_to_supplier_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'finance')
  ));

CREATE OR REPLACE FUNCTION public.request_grn_return(
  p_grn_id uuid,
  p_lines jsonb,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_grn public.goods_received_notes%ROWTYPE;
  v_rts_id uuid;
  v_rts_number text;
  v_line jsonb;
  v_grn_item public.grn_items%ROWTYPE;
  v_quantity numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('finance', 'admin')
  ) THEN
    RAISE EXCEPTION 'Only Finance or Admin users can create an RTS.';
  END IF;
  IF NULLIF(BTRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A return reason is required.';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one return line is required.';
  END IF;

  SELECT * INTO v_grn
  FROM public.goods_received_notes
  WHERE id = p_grn_id
  FOR SHARE;

  IF NOT FOUND OR v_grn.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved GRNs can be returned to supplier.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sync_log
    WHERE event_type = 'grn_confirmed'
      AND reference_id = p_grn_id
      AND status = 'success'
  ) THEN
    RAISE EXCEPTION 'The GRN must be posted successfully to Sage before an RTS can be created.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.return_to_supplier_requests
    WHERE original_grn_id = p_grn_id
      AND status IN ('pending_finance', 'approved', 'processing', 'posted')
  ) THEN
    RAISE EXCEPTION 'An RTS already exists for this GRN.';
  END IF;

  v_rts_number := 'RTS-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  INSERT INTO public.return_to_supplier_requests (
    rts_number, original_grn_id, original_grn_number, supplier_id, warehouse_id, reason, created_by
  ) VALUES (
    v_rts_number, v_grn.id, v_grn.grn_number, v_grn.supplier_id, v_grn.warehouse_id, BTRIM(p_reason), auth.uid()
  ) RETURNING id INTO v_rts_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_grn_item
    FROM public.grn_items
    WHERE id = (v_line->>'grn_item_id')::uuid
      AND grn_id = p_grn_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A selected return line does not belong to this GRN.';
    END IF;

    v_quantity := (v_line->>'quantity')::numeric;
    IF v_quantity IS NULL OR v_quantity <= 0 OR v_quantity > v_grn_item.received_qty THEN
      RAISE EXCEPTION 'Return quantity must be greater than zero and no more than the received quantity.';
    END IF;

    INSERT INTO public.return_to_supplier_items (
      rts_id, grn_item_id, raw_material_id, quantity, unit_cost, batch_number, expiry_date
    ) VALUES (
      v_rts_id, v_grn_item.id, v_grn_item.raw_material_id, v_quantity, v_grn_item.unit_cost,
      v_grn_item.batch_number, v_grn_item.expiry_date
    );
  END LOOP;

  RETURN v_rts_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_grn_return(p_rts_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rts public.return_to_supplier_requests%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('finance', 'admin')
  ) THEN
    RAISE EXCEPTION 'Only Finance or Admin users can approve an RTS.';
  END IF;

  SELECT * INTO v_rts
  FROM public.return_to_supplier_requests
  WHERE id = p_rts_id
  FOR UPDATE;

  IF NOT FOUND OR v_rts.status <> 'pending_finance' THEN
    RAISE EXCEPTION 'Only a pending-finance RTS can be approved.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.return_to_supplier_items WHERE rts_id = p_rts_id
  ) THEN
    RAISE EXCEPTION 'An RTS must contain at least one line.';
  END IF;

  UPDATE public.return_to_supplier_requests
  SET status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
  WHERE id = p_rts_id;

  INSERT INTO public.sync_log (event_type, reference_id, reference_type, status, message, details)
  VALUES (
    'return_to_supplier_requested', p_rts_id, 'return_to_supplier', 'pending',
    'RTS approved by Finance; queued for Sage.',
    jsonb_build_object('rtsNumber', v_rts.rts_number)
  );
END;
$$;

COMMENT ON TABLE public.return_to_supplier_requests IS
  'Finance-controlled RTS documents. Original GRNs remain unchanged.';

GRANT EXECUTE ON FUNCTION public.request_grn_return(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_grn_return(uuid) TO authenticated;
