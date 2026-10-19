-- Add a batch entry point; retain the existing per-line stock/reservation guards.
-- No historical transfer, stock balance or Sage posting is modified.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.create_material_transfer_bundle(
  p_lines jsonb, p_from_warehouse_id uuid, p_transfer_date date, p_purpose text,
  p_notes text, p_production_order_id uuid, p_requested_by uuid, p_transfer_batch_key uuid
) RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line record; v_ids uuid[] := '{}'; v_id uuid;
  v_expected jsonb; v_existing jsonb; v_ist text := upper(btrim(coalesce(p_purpose, '')));
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_requested_by OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid()
      AND role IN ('admin','production_manager','supervisor','warehouse_manager',
        'warehouse_clerk','raw_material_manager','rm_manager','logistics')
  ) THEN RAISE EXCEPTION 'This user cannot create material transfers.' USING ERRCODE = '42501'; END IF;
  IF p_transfer_batch_key IS NULL OR v_ist !~ '^HFIST[0-9]+$' THEN
    RAISE EXCEPTION 'A valid IST and request key are required.';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Transfer lines must be an array.';
  END IF;
  IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Select between one and 20 material lines.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_lines) AS l(raw_material_id uuid, quantity numeric, unit text)
    WHERE raw_material_id IS NULL OR quantity IS NULL OR quantity <= 0
      OR quantity::text IN ('NaN', 'Infinity', '-Infinity'))
    OR (SELECT count(*) FROM jsonb_to_recordset(p_lines) AS l(raw_material_id uuid))
      <> (SELECT count(DISTINCT raw_material_id) FROM jsonb_to_recordset(p_lines) AS l(raw_material_id uuid)) THEN
    RAISE EXCEPTION 'Each material must appear once with a positive finite quantity.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('material-transfer-batch:' || p_transfer_batch_key::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_ist, 0));
  SELECT jsonb_agg(jsonb_build_object(
    'material', l.raw_material_id, 'quantity', l.quantity, 'unit', coalesce(nullif(l.unit,''),'kg'),
    'warehouse', p_from_warehouse_id, 'date', coalesce(p_transfer_date, current_date),
    'ist', v_ist, 'notes', coalesce(p_notes,''), 'order', p_production_order_id, 'user', p_requested_by
  ) ORDER BY l.raw_material_id) INTO v_expected
  FROM jsonb_to_recordset(p_lines) AS l(raw_material_id uuid, quantity numeric, unit text);

  SELECT jsonb_agg(jsonb_build_object(
    'material', raw_material_id, 'quantity', quantity, 'unit', unit,
    'warehouse', from_warehouse_id, 'date', transfer_date,
    'ist', upper(btrim(purpose)), 'notes', coalesce(notes,''), 'order', production_order_id, 'user', requested_by
  ) ORDER BY raw_material_id), array_agg(id ORDER BY raw_material_id)
  INTO v_existing, v_ids FROM public.material_transfers WHERE transfer_batch_key = p_transfer_batch_key;
  IF v_existing IS NOT NULL THEN
    IF v_existing IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'This request key already belongs to a different transfer. Review the existing IST; no additional lines were created.';
    END IF;
    RETURN v_ids;
  END IF;

  v_ids := '{}';
  -- A later line failure rolls back every earlier line and Buffer reservation.
  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines)
    AS l(raw_material_id uuid, quantity numeric, unit text) ORDER BY raw_material_id LOOP
    v_id := public.create_material_transfer_to_buffer(
      v_line.raw_material_id, p_from_warehouse_id, v_line.quantity, v_line.unit,
      p_transfer_date, v_ist, p_notes, p_production_order_id, p_requested_by, p_transfer_batch_key);
    v_ids := array_append(v_ids, v_id);
  END LOOP;
  RETURN v_ids;
END; $$;
REVOKE ALL ON FUNCTION public.create_material_transfer_bundle(jsonb, uuid, date, text, text, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_material_transfer_bundle(jsonb, uuid, date, text, text, uuid, uuid, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
