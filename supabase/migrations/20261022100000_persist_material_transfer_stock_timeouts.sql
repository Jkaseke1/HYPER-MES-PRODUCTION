BEGIN;

CREATE TABLE public.material_transfer_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_batch_key uuid NOT NULL UNIQUE,
  transfer_date date NOT NULL,
  purpose text NOT NULL,
  notes text,
  production_order_id uuid REFERENCES public.production_orders(id),
  from_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  requested_by uuid NOT NULL REFERENCES public.profiles(id),
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verifying', 'needs_review', 'created', 'cancelled')),
  refresh_log_id uuid REFERENCES public.sync_log(id) ON DELETE SET NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  transfer_ids uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX material_transfer_requests_status_created_idx
  ON public.material_transfer_requests(status, created_at DESC);
CREATE INDEX material_transfer_requests_requester_idx
  ON public.material_transfer_requests(requested_by, created_at DESC);

ALTER TABLE public.material_transfer_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY material_transfer_requests_read_owner_or_admin
  ON public.material_transfer_requests FOR SELECT TO authenticated
  USING (
    requested_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );
REVOKE ALL ON public.material_transfer_requests FROM PUBLIC, anon;
GRANT SELECT ON public.material_transfer_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.save_material_transfer_request(
  p_transfer_batch_key uuid,
  p_lines jsonb,
  p_from_warehouse_id uuid,
  p_transfer_date date,
  p_purpose text,
  p_notes text,
  p_production_order_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_ist text := upper(btrim(coalesce(p_purpose, '')));
  v_lines jsonb;
  v_count integer;
  v_existing public.material_transfer_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid()
      AND role IN ('admin','production_manager','supervisor','warehouse_manager',
        'warehouse_clerk','raw_material_manager','rm_manager','logistics')
  ) THEN RAISE EXCEPTION 'This user cannot create material transfer requests.' USING ERRCODE = '42501'; END IF;
  IF p_transfer_batch_key IS NULL OR v_ist !~ '^HFIST[0-9]+$' THEN
    RAISE EXCEPTION 'A valid IST and request key are required.';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array'
    OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Select between one and 20 material lines.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses
      WHERE id = p_from_warehouse_id AND upper(code) = 'RM' AND is_active) THEN
    RAISE EXCEPTION 'Transfers must originate from the active RM warehouse.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_lines) AS l(raw_material_id uuid, quantity numeric, unit text)
    WHERE raw_material_id IS NULL OR quantity IS NULL OR quantity <= 0
      OR quantity::text IN ('NaN', 'Infinity', '-Infinity')
  ) OR (SELECT count(*) FROM jsonb_to_recordset(p_lines) AS l(raw_material_id uuid))
      <> (SELECT count(DISTINCT raw_material_id) FROM jsonb_to_recordset(p_lines) AS l(raw_material_id uuid)) THEN
    RAISE EXCEPTION 'Each material must appear once with a positive finite quantity.';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'raw_material_id', l.raw_material_id,
    'quantity', l.quantity,
    'unit', coalesce(nullif(l.unit, ''), m.unit, 'kg')
  ) ORDER BY l.raw_material_id), count(*)
  INTO v_lines, v_count
  FROM jsonb_to_recordset(p_lines) AS l(raw_material_id uuid, quantity numeric, unit text)
  JOIN public.raw_materials m ON m.id = l.raw_material_id AND m.is_active
    AND coalesce(nullif(l.unit, ''), m.unit, 'kg') = coalesce(m.unit, 'kg')
    AND coalesce(nullif(m.sage_code, ''), nullif(m.code, '')) IS NOT NULL;
  IF coalesce(v_count, 0) <> jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION 'Every line must use an active Sage-linked material and its configured unit.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('material-transfer-ist:' || v_ist, 0));
  SELECT * INTO v_existing FROM public.material_transfer_requests
    WHERE transfer_batch_key = p_transfer_batch_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.requested_by <> auth.uid()
      OR v_existing.purpose <> v_ist
      OR v_existing.transfer_date <> p_transfer_date
      OR v_existing.from_warehouse_id <> p_from_warehouse_id
      OR v_existing.lines <> v_lines
      OR v_existing.notes IS DISTINCT FROM p_notes
      OR v_existing.production_order_id IS DISTINCT FROM p_production_order_id THEN
      RAISE EXCEPTION 'This request key is already attached to different transfer details.';
    END IF;
    IF v_existing.status = 'cancelled' THEN RAISE EXCEPTION 'This transfer request was cancelled.'; END IF;
    RETURN v_existing.id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.material_transfers t
    WHERE upper(btrim(t.purpose)) = v_ist AND t.status <> 'rejected'
      AND t.reversed_at IS NULL AND t.reversed_by IS NULL
  ) THEN RAISE EXCEPTION 'IST % already exists in the transfer register.', v_ist; END IF;
  SELECT id INTO v_id FROM public.material_transfer_requests r
    WHERE upper(btrim(r.purpose)) = v_ist AND r.status NOT IN ('created', 'cancelled')
    LIMIT 1;
  IF v_id IS NOT NULL THEN
    RAISE EXCEPTION 'IST % already has a saved request awaiting review (request %).', v_ist, v_id;
  END IF;

  INSERT INTO public.material_transfer_requests (
    transfer_batch_key, transfer_date, purpose, notes, production_order_id,
    from_warehouse_id, requested_by, lines
  ) VALUES (
    p_transfer_batch_key, p_transfer_date, v_ist, p_notes, p_production_order_id,
    p_from_warehouse_id, auth.uid(), v_lines
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_material_transfer_request_check(p_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.material_transfer_requests%ROWTYPE;
  v_log public.sync_log%ROWTYPE;
  v_log_id uuid;
  v_ids uuid[];
BEGIN
  SELECT * INTO v_request FROM public.material_transfer_requests
    WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Saved transfer request not found.'; END IF;
  IF auth.uid() IS NULL OR (auth.uid() <> v_request.requested_by AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  )) THEN RAISE EXCEPTION 'Only the requester or an administrator can retry this request.' USING ERRCODE = '42501'; END IF;
  IF v_request.status IN ('created', 'cancelled') THEN
    RAISE EXCEPTION 'This request is already %.', v_request.status;
  END IF;

  SELECT array_agg((line->>'raw_material_id')::uuid ORDER BY (line->>'raw_material_id')::uuid)
    INTO v_ids FROM jsonb_array_elements(v_request.lines) line;
  IF v_request.refresh_log_id IS NOT NULL THEN
    SELECT * INTO v_log FROM public.sync_log WHERE id = v_request.refresh_log_id;
    IF FOUND AND v_log.event_type = 'sage_stock_refresh'
      AND v_log.status IN ('pending', 'processing') AND v_log.updated_at > now() - interval '5 minutes' THEN
      UPDATE public.material_transfer_requests SET
        status = 'verifying', last_error = NULL, updated_at = now()
      WHERE id = p_request_id;
      RETURN v_log.id;
    END IF;
    IF FOUND AND v_log.event_type = 'sage_stock_refresh'
      AND v_log.status = 'success' AND v_log.updated_at > now() - interval '2 minutes' THEN
      UPDATE public.material_transfer_requests SET
        status = 'verifying', last_error = NULL, updated_at = now()
      WHERE id = p_request_id;
      RETURN v_log.id;
    END IF;
  END IF;

  v_log_id := public.request_material_transfer_sage_refresh(v_ids);
  UPDATE public.material_transfer_requests SET
    status = 'verifying', refresh_log_id = v_log_id,
    attempt_count = attempt_count + 1, last_error = NULL, updated_at = now()
  WHERE id = p_request_id;
  RETURN v_log_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_material_transfer_request_failure(
  p_request_id uuid, p_error text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.material_transfer_requests r SET
    status = 'needs_review', last_error = left(coalesce(nullif(btrim(p_error), ''), 'Stock verification did not complete.'), 2000),
    updated_at = now()
  WHERE r.id = p_request_id AND r.status NOT IN ('created', 'cancelled')
    AND (r.requested_by = auth.uid() OR EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    ));
  IF NOT FOUND THEN RAISE EXCEPTION 'Request cannot be updated by this user or is already closed.' USING ERRCODE = '42501'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_material_transfer_request(p_request_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.material_transfer_requests%ROWTYPE;
  v_log public.sync_log%ROWTYPE;
  v_ids uuid[];
BEGIN
  SELECT * INTO v_request FROM public.material_transfer_requests
    WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Saved transfer request not found.'; END IF;
  IF auth.uid() IS NULL OR (auth.uid() <> v_request.requested_by AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  )) THEN RAISE EXCEPTION 'Only the requester or an administrator can complete this request.' USING ERRCODE = '42501'; END IF;
  IF v_request.status = 'created' THEN RETURN coalesce(v_request.transfer_ids, '{}'); END IF;
  IF v_request.status = 'cancelled' THEN RAISE EXCEPTION 'This request was cancelled.'; END IF;
  IF v_request.refresh_log_id IS NULL THEN RAISE EXCEPTION 'Run a fresh Sage stock check before completing this request.'; END IF;

  SELECT * INTO v_log FROM public.sync_log WHERE id = v_request.refresh_log_id FOR SHARE;
  IF NOT FOUND OR v_log.event_type <> 'sage_stock_refresh' OR v_log.status <> 'success' THEN
    RAISE EXCEPTION 'Sage stock verification has not succeeded. No transfer or stock movement was created.';
  END IF;

  SELECT public.create_material_transfer_bundle(
    v_request.lines, v_request.from_warehouse_id, v_request.transfer_date,
    v_request.purpose, v_request.notes, v_request.production_order_id,
    auth.uid(), v_request.transfer_batch_key
  ) INTO v_ids;

  UPDATE public.material_transfer_requests SET
    status = 'created', transfer_ids = v_ids, last_error = NULL,
    completed_at = now(), updated_at = now()
  WHERE id = p_request_id;
  RETURN v_ids;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_material_transfer_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN RAISE EXCEPTION 'Only an administrator can cancel a saved transfer request.' USING ERRCODE = '42501'; END IF;
  UPDATE public.material_transfer_requests SET
    status = 'cancelled', updated_at = now()
  WHERE id = p_request_id AND status <> 'created';
  IF NOT FOUND THEN RAISE EXCEPTION 'Request was not found or has already created transfers.'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_material_transfer_request(uuid, jsonb, uuid, date, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_material_transfer_request_check(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_material_transfer_request_failure(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_material_transfer_request(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_material_transfer_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_material_transfer_request(uuid, jsonb, uuid, date, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_material_transfer_request_check(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_material_transfer_request_failure(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_material_transfer_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_material_transfer_request(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
