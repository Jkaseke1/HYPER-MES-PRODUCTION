-- Cost metadata only. Existing completed orders and inventory are not recalculated.
BEGIN;
CREATE TABLE IF NOT EXISTS public.production_order_packaging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  packaging_sku_id uuid NOT NULL REFERENCES public.packaging_skus(id),
  item_code text NOT NULL,
  description text NOT NULL,
  unit text NOT NULL DEFAULT 'bags',
  planned_qty numeric NOT NULL DEFAULT 0 CHECK (planned_qty >= 0),
  actual_qty numeric NOT NULL DEFAULT 0 CHECK (actual_qty >= 0),
  unit_cost numeric NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (production_order_id, packaging_sku_id)
);
CREATE INDEX IF NOT EXISTS idx_production_order_packaging_order ON public.production_order_packaging(production_order_id);
ALTER TABLE public.production_order_packaging ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read order packaging costs" ON public.production_order_packaging;
CREATE POLICY "Read order packaging costs" ON public.production_order_packaging FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Record actual order packaging" ON public.production_order_packaging;
CREATE POLICY "Record actual order packaging" ON public.production_order_packaging FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.production_orders po WHERE po.id = production_order_id AND po.status <> 'completed'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.production_orders po WHERE po.id = production_order_id AND po.status <> 'completed'));

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS packaging_cost numeric NOT NULL DEFAULT 0 CHECK (packaging_cost >= 0);

CREATE OR REPLACE FUNCTION public.set_production_packaging_cost(p_packaging_id uuid, p_unit_cost numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  order_id uuid;
  order_status text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'finance', 'accountant')) THEN
    RAISE EXCEPTION 'Finance access is required to set packaging costs.';
  END IF;
  IF p_unit_cost IS NULL OR p_unit_cost <= 0 OR p_unit_cost::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Enter a positive packaging cost per unit.';
  END IF;
  SELECT production_order_id INTO order_id FROM public.production_order_packaging WHERE id = p_packaging_id;
  SELECT status INTO order_status FROM public.production_orders WHERE id = order_id FOR UPDATE;
  IF order_status IS NULL OR order_status NOT IN ('pending', 'pending_finance', 'materials_issued', 'in_progress') THEN
    RAISE EXCEPTION 'Packaging costs can only be set on open orders.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sync_log WHERE reference_id = order_id
    AND event_type = 'production_completed' AND status IN ('pending', 'processing', 'success', 'failed')) THEN
    RAISE EXCEPTION 'Review the existing manufacturing posting before changing costs.';
  END IF;
  UPDATE public.production_order_packaging SET unit_cost = p_unit_cost WHERE id = p_packaging_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_production_packaging_cost(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_production_packaging_cost(uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_production_order_packaging(p_order_id uuid, p_sku_id uuid, p_quantity numeric, p_unit_cost numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  snapshot_id uuid;
  sku public.packaging_skus%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.production_orders WHERE id = p_order_id FOR UPDATE;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity::text IN ('NaN', 'Infinity', '-Infinity') OR p_quantity <> trunc(p_quantity) THEN
    RAISE EXCEPTION 'Enter a positive whole number of packaging units.';
  END IF;
  SELECT * INTO sku FROM public.packaging_skus WHERE id = p_sku_id AND is_active = true AND sage_stock_code IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select active Sage-linked packaging.'; END IF;
  IF EXISTS (SELECT 1 FROM public.production_order_packaging WHERE production_order_id = p_order_id) THEN
    RAISE EXCEPTION 'Packaging is already saved on this order. Edit its unit cost instead.';
  END IF;
  INSERT INTO public.production_order_packaging(production_order_id, packaging_sku_id, item_code, description, planned_qty)
    VALUES (p_order_id, p_sku_id, sku.sage_stock_code, sku.description, p_quantity) RETURNING id INTO snapshot_id;
  -- Any permission/status failure rolls back the snapshot insert as well.
  PERFORM public.set_production_packaging_cost(snapshot_id, p_unit_cost);
END;
$$;
REVOKE ALL ON FUNCTION public.set_production_order_packaging(uuid, uuid, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_production_order_packaging(uuid, uuid, numeric, numeric) TO authenticated;
COMMIT;
