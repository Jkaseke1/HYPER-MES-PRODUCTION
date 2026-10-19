-- No existing balances or transfers are rewritten. Sage remains stock authority.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.stamp_sage_raw_stock_receipt()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.raw_material_id IS NOT NULL AND auth.role() = 'service_role' THEN
    NEW.last_synced_at := clock_timestamp();
    NEW.updated_at := NEW.last_synced_at;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS stamp_sage_raw_stock_receipt ON public.sage_stock_balances;
CREATE TRIGGER stamp_sage_raw_stock_receipt
  BEFORE INSERT OR UPDATE ON public.sage_stock_balances
  FOR EACH ROW EXECUTE FUNCTION public.stamp_sage_raw_stock_receipt();

CREATE OR REPLACE FUNCTION public.read_material_transfer_stock(p_material_ids uuid[], p_warehouse_id integer)
RETURNS TABLE(raw_material_id uuid, quantity numeric, last_synced_at timestamptz, is_fresh boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT s.raw_material_id, s.quantity, s.last_synced_at,
    coalesce(s.last_synced_at >= now() - interval '2 minutes'
      AND s.last_synced_at <= now() + interval '5 seconds', false)
  FROM public.sage_stock_balances s
  WHERE auth.uid() IS NOT NULL AND p_warehouse_id IN (18, 19)
    AND cardinality(p_material_ids) BETWEEN 1 AND 20
    AND s.warehouse_id = p_warehouse_id AND s.raw_material_id = ANY(p_material_ids);
$$;
REVOKE ALL ON FUNCTION public.read_material_transfer_stock(uuid[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_material_transfer_stock(uuid[], integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
