-- Repair a missing reference without reopening approved financial lines.
CREATE OR REPLACE FUNCTION public.complete_missing_manual_grv(p_grn_id uuid, p_manual_grv text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_grn public.goods_received_notes%ROWTYPE;
  v_sync public.sync_log%ROWTYPE;
  v_reference text := upper(btrim(p_manual_grv));
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'finance')
  ) THEN
    RAISE EXCEPTION 'Only Finance or Admin can complete the manual GRV reference';
  END IF;
  IF v_reference IS NULL OR v_reference !~ '^HFGRV[0-9]+$' OR length(v_reference) > 50 THEN
    RAISE EXCEPTION 'Enter HFGRV followed by digits (maximum 50 characters)';
  END IF;
  SELECT * INTO v_grn FROM public.goods_received_notes WHERE id = p_grn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GRN not found'; END IF;
  IF v_grn.status <> 'approved' OR nullif(btrim(v_grn.manual_grv_number), '') IS NOT NULL THEN
    RAISE EXCEPTION 'Only an approved GRN with a missing manual reference can be corrected here';
  END IF;
  -- Lock the queue entry so a concurrent retry cannot claim it during correction.
  SELECT * INTO v_sync FROM public.sync_log
  WHERE reference_id = p_grn_id AND event_type = 'grn_confirmed'
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No failed Sage posting found'; END IF;
  IF v_sync.status <> 'failed' OR coalesce(v_sync.message, '') NOT ILIKE '%has no manual HFGRV reference%' THEN
    RAISE EXCEPTION 'This action requires a posting failure caused by the missing manual HFGRV reference';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sync_log WHERE reference_id = p_grn_id
    AND event_type = 'grn_confirmed' AND status IN ('success', 'processing', 'pending', 'retry')) THEN
    RAISE EXCEPTION 'This GRN has a successful or active Sage posting; refresh its status';
  END IF;
  UPDATE public.goods_received_notes SET manual_grv_number = v_reference, updated_at = now()
  WHERE id = p_grn_id;
  INSERT INTO public.approval_history
    (entity_type, entity_id, action, previous_status, new_status, approved_by, comments)
  VALUES ('grn', p_grn_id, 'reference_corrected', v_grn.status, v_grn.status, auth.uid(),
    'Missing manual GRV completed: ' || v_reference || '. Sage retry remains a separate action.');
  RETURN v_reference;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_missing_manual_grv(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_missing_manual_grv(uuid, text) TO authenticated;
