-- Production Material Transfer support tables.
-- Schema only: no warehouses, stock balances, transfers, or Sage events are
-- inserted or changed by this migration.

ALTER TABLE public.material_transfers
  ADD COLUMN IF NOT EXISTS buffer_approved_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS buffer_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS production_approved_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS production_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS buffer_warehouse_id uuid REFERENCES public.warehouses(id);

ALTER TABLE public.material_transfers
  DROP CONSTRAINT IF EXISTS material_transfers_status_check;

ALTER TABLE public.material_transfers
  ADD CONSTRAINT material_transfers_status_check
  CHECK (status IN ('pending', 'in_buffer', 'approved', 'in_transit', 'received', 'rejected'));

ALTER TABLE public.warehouses
  DROP CONSTRAINT IF EXISTS warehouses_type_check;

ALTER TABLE public.warehouses
  ADD CONSTRAINT warehouses_type_check
  CHECK (type IN ('raw_material', 'finished_goods', 'buffer'));

CREATE TABLE IF NOT EXISTS public.warehouse_stock_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  quantity numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (raw_material_id, warehouse_id)
);

ALTER TABLE public.warehouse_stock_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read warehouse_stock_balances" ON public.warehouse_stock_balances;
DROP POLICY IF EXISTS "Authenticated users can insert warehouse_stock_balances" ON public.warehouse_stock_balances;
DROP POLICY IF EXISTS "Authenticated users can update warehouse_stock_balances" ON public.warehouse_stock_balances;

CREATE POLICY "Authenticated users can read warehouse_stock_balances"
  ON public.warehouse_stock_balances FOR SELECT TO authenticated
  USING ((select auth.uid()) IS NOT NULL);

CREATE POLICY "Authenticated users can insert warehouse_stock_balances"
  ON public.warehouse_stock_balances FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) IS NOT NULL);

CREATE POLICY "Authenticated users can update warehouse_stock_balances"
  ON public.warehouse_stock_balances FOR UPDATE TO authenticated
  USING ((select auth.uid()) IS NOT NULL)
  WITH CHECK ((select auth.uid()) IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_warehouse_stock_balances_material
  ON public.warehouse_stock_balances(raw_material_id);

CREATE INDEX IF NOT EXISTS idx_warehouse_stock_balances_warehouse
  ON public.warehouse_stock_balances(warehouse_id);
