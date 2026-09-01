-- Production master-data UI contract fields.
-- Schema only: no master rows, stock, costs, mappings, or integrations are activated.

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS sage_code text,
  ADD COLUMN IF NOT EXISTS sage_warehouse_code text,
  ADD COLUMN IF NOT EXISTS sage_warehouse_id integer;

ALTER TABLE public.warehouses
  ADD COLUMN IF NOT EXISTS sage_warehouse_code text,
  ADD COLUMN IF NOT EXISTS sage_warehouse_id integer;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS sage_code text;

ALTER TABLE public.raw_materials
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS cost_per_unit_usd numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_reorder_level numeric NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
