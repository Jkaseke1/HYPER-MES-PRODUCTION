-- Stock take counts are a controlled reconciliation record. They must never
-- silently overwrite Sage or MES on-hand stock when a take is closed.

ALTER TABLE public.stock_take_lines
  ADD COLUMN IF NOT EXISTS variance_reason text;

ALTER TABLE public.stock_take_lines
  DROP CONSTRAINT IF EXISTS stock_take_lines_counted_qty_nonnegative,
  DROP CONSTRAINT IF EXISTS stock_take_lines_recount_qty_nonnegative;

ALTER TABLE public.stock_take_lines
  ADD CONSTRAINT stock_take_lines_counted_qty_nonnegative
    CHECK (counted_qty IS NULL OR counted_qty >= 0),
  ADD CONSTRAINT stock_take_lines_recount_qty_nonnegative
    CHECK (recount_qty IS NULL OR recount_qty >= 0);

-- A recount replaces the first count as the variance basis. Existing screens
-- can keep reading the same `variance` column, but now see the final count.
ALTER TABLE public.stock_take_lines DROP COLUMN IF EXISTS variance;
ALTER TABLE public.stock_take_lines
  ADD COLUMN variance numeric
    GENERATED ALWAYS AS (COALESCE(recount_qty, counted_qty, 0) - system_qty) STORED;

CREATE OR REPLACE FUNCTION public.review_stock_take_variance(
  p_line_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role text;
  v_line public.stock_take_lines%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF COALESCE(v_role, '') NOT IN ('admin', 'md', 'finance', 'accountant') THEN
    RAISE EXCEPTION 'Only Finance or an administrator can approve a stock variance.';
  END IF;

  SELECT * INTO v_line
  FROM public.stock_take_lines
  WHERE id = p_line_id
  FOR UPDATE;

  IF NOT FOUND OR v_line.counted_qty IS NULL THEN
    RAISE EXCEPTION 'A count is required before a variance can be reviewed.';
  END IF;

  IF v_line.variance = 0 THEN
    RAISE EXCEPTION 'A zero-variance line does not need Finance approval.';
  END IF;

  IF v_line.needs_recount AND v_line.recount_qty IS NULL THEN
    RAISE EXCEPTION 'Enter the recount quantity before Finance reviews this line.';
  END IF;

  IF v_line.system_qty > 0
    AND ABS(v_line.variance / v_line.system_qty) > 0.05
    AND v_line.recount_qty IS NULL THEN
    RAISE EXCEPTION 'A variance above 5%% requires a recount before Finance review.';
  END IF;

  IF NULLIF(BTRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A written variance reason is required.';
  END IF;

  UPDATE public.stock_take_lines
  SET approved_by = auth.uid(),
      approved_at = NOW(),
      variance_reason = BTRIM(p_reason),
      needs_recount = false,
      is_locked = true
  WHERE id = p_line_id;

  INSERT INTO public.stock_take_audit_log (
    stock_take_id, line_id, action, old_value, new_value, changed_by, notes
  ) VALUES (
    v_line.stock_take_id, p_line_id, 'variance_approved',
    v_line.variance, v_line.variance, auth.uid(), BTRIM(p_reason)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_stock_take(p_stock_take_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role text;
  v_take public.stock_takes%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF COALESCE(v_role, '') NOT IN ('admin', 'md', 'warehouse_manager', 'raw_material_manager') THEN
    RAISE EXCEPTION 'Only the Raw Materials/Warehouse owner or an administrator can close a stock take.';
  END IF;

  SELECT * INTO v_take
  FROM public.stock_takes
  WHERE id = p_stock_take_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock take not found.';
  END IF;
  IF v_take.status <> 'FROZEN' THEN
    RAISE EXCEPTION 'Freeze the stock take before closing it.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.stock_take_lines
    WHERE stock_take_id = p_stock_take_id AND counted_qty IS NULL
  ) THEN
    RAISE EXCEPTION 'Every stock-take line must be counted before closing.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.stock_take_lines
    WHERE stock_take_id = p_stock_take_id AND needs_recount
  ) THEN
    RAISE EXCEPTION 'Resolve every flagged recount before closing.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.stock_take_lines
    WHERE stock_take_id = p_stock_take_id
      AND variance <> 0
      AND (approved_by IS NULL OR NULLIF(BTRIM(variance_reason), '') IS NULL)
  ) THEN
    RAISE EXCEPTION 'Every variance requires a Finance-approved written reason before closing.';
  END IF;

  UPDATE public.stock_takes
  SET status = 'CLOSED',
      closed_by = auth.uid(),
      closed_at = NOW()
  WHERE id = p_stock_take_id;

  INSERT INTO public.stock_take_audit_log (
    stock_take_id, action, changed_by, notes
  ) VALUES (
    p_stock_take_id, 'stock_take_closed', auth.uid(),
    'Closed after all counts, recounts, and variance reviews were completed. No automatic Sage or MES stock adjustment was posted.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_stock_take_variance(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_stock_take(uuid) TO authenticated, service_role;

COMMENT ON COLUMN public.stock_take_lines.variance_reason IS
  'Finance-approved explanation for a non-zero final stock-take variance.';
