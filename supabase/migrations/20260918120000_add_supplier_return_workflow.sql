-- Controlled Sage Return to Supplier workflow for correcting posted GRNs.
-- The original GRN remains immutable; the RTS is a separate auditable document.

ALTER TABLE public.sync_log
  DROP CONSTRAINT IF EXISTS sync_log_event_type_check;

ALTER TABLE public.sync_log
  ADD CONSTRAINT sync_log_event_type_check CHECK (event_type IN (
    'grn_confirmed', 'supplier_return', 'materials_issued', 'production_completed',
    'dispatch_delivered', 'price_sync', 'customer_sync', 'error'
  ));

CREATE TABLE IF NOT EXISTS public.supplier_return_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_grn_id uuid NOT NULL REFERENCES public.goods_received_notes(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'processing', 'posted', 'failed', 'cancelled')),
  requested_by uuid NOT NULL REFERENCES public.profiles(id),
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  sage_rts_number text,
  sage_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_return_id uuid NOT NULL REFERENCES public.supplier_return_requests(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_cost numeric NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_return_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_return_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance can read supplier returns" ON public.supplier_return_requests;
CREATE POLICY "Finance can read supplier returns" ON public.supplier_return_requests
  FOR SELECT TO authenticated USING (public.has_mes_role(ARRAY['admin', 'finance', 'accountant']));

DROP POLICY IF EXISTS "Finance can read supplier return items" ON public.supplier_return_items;
CREATE POLICY "Finance can read supplier return items" ON public.supplier_return_items
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.supplier_return_requests r
    WHERE r.id = supplier_return_items.supplier_return_id
      AND public.has_mes_role(ARRAY['admin', 'finance', 'accountant'])
  ));

CREATE OR REPLACE FUNCTION public.create_supplier_return(
  p_original_grn_id uuid,
  p_reason text,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grn public.goods_received_notes%ROWTYPE;
  v_return_id uuid;
  v_item jsonb;
  v_original_qty numeric;
  v_requested_qty numeric;
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'finance', 'accountant']) THEN
    RAISE EXCEPTION 'Only Finance, Accountant, or Admin users can create a supplier return.';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A return reason is required.';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one return line is required.';
  END IF;

  SELECT * INTO v_grn FROM public.goods_received_notes WHERE id = p_original_grn_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original GRN was not found.'; END IF;
  IF v_grn.status <> 'approved' THEN RAISE EXCEPTION 'Only an approved GRN can have an RTS.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sync_log WHERE event_type = 'grn_confirmed'
      AND reference_id = p_original_grn_id AND status = 'success'
  ) THEN
    RAISE EXCEPTION 'The original GRN must be posted successfully to Sage before creating an RTS.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.supplier_return_requests
    WHERE original_grn_id = p_original_grn_id AND status IN ('draft', 'approved', 'processing')
  ) THEN
    RAISE EXCEPTION 'This GRN already has an open supplier return.';
  END IF;

  INSERT INTO public.supplier_return_requests (original_grn_id, reason, requested_by)
  VALUES (p_original_grn_id, btrim(p_reason), auth.uid())
  RETURNING id INTO v_return_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_requested_qty := NULLIF((v_item->>'quantity')::numeric, 0);
    IF v_requested_qty IS NULL OR v_requested_qty <= 0 THEN
      RAISE EXCEPTION 'Every RTS quantity must be greater than zero.';
    END IF;
    SELECT COALESCE(SUM(ri.received_qty), 0) INTO v_original_qty
    FROM public.grn_items ri
    WHERE ri.grn_id = p_original_grn_id AND ri.raw_material_id = (v_item->>'raw_material_id')::uuid;
    IF v_requested_qty > v_original_qty THEN
      RAISE EXCEPTION 'RTS quantity exceeds the original received quantity.';
    END IF;
    INSERT INTO public.supplier_return_items (supplier_return_id, raw_material_id, quantity, unit_cost)
    VALUES (v_return_id, (v_item->>'raw_material_id')::uuid, v_requested_qty, COALESCE((v_item->>'unit_cost')::numeric, 0));
  END LOOP;

  INSERT INTO public.sync_log (event_type, reference_type, reference_id, status, message, details)
  VALUES ('supplier_return', 'supplier_return_requests', v_return_id, 'retry',
    'Supplier return queued for Finance approval', jsonb_build_object('originalGrnId', p_original_grn_id));
  RETURN v_return_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_supplier_return(p_return_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'finance', 'accountant']) THEN
    RAISE EXCEPTION 'Only Finance, Accountant, or Admin users can approve a supplier return.';
  END IF;
  UPDATE public.supplier_return_requests
  SET status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
  WHERE id = p_return_id AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier return is not in draft status.'; END IF;
  UPDATE public.sync_log
  SET status = 'pending', message = 'Supplier return approved; queued for Sage RTS posting', updated_at = now()
  WHERE event_type = 'supplier_return' AND reference_id = p_return_id AND status = 'retry';
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_supplier_return(uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_supplier_return(uuid) TO authenticated, service_role;
