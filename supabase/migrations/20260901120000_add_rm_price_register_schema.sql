-- Production RM Prices schema.
-- Structure only: no historical costs, exchange rates, or UAT records are seeded.

CREATE TABLE IF NOT EXISTS public.usd_zig_rate_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_date date UNIQUE NOT NULL,
  rate numeric(10,4) NOT NULL,
  set_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rm_cost_register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_id uuid REFERENCES public.raw_materials(id),
  effective_date date NOT NULL,
  cost_per_tonne_usd numeric(12,4) NOT NULL,
  source text CHECK (source IN ('GRN', 'MANUAL', 'SAGE_SYNC')),
  grn_id uuid REFERENCES public.goods_received_notes(id),
  usd_zig_rate numeric(10,4),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.usd_zig_rate_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rm_cost_register ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read usd_zig_rate_history" ON public.usd_zig_rate_history;
DROP POLICY IF EXISTS "Authenticated users can insert usd_zig_rate_history" ON public.usd_zig_rate_history;
DROP POLICY IF EXISTS "Authenticated users can update usd_zig_rate_history" ON public.usd_zig_rate_history;
CREATE POLICY "Authenticated users can read usd_zig_rate_history"
  ON public.usd_zig_rate_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert usd_zig_rate_history"
  ON public.usd_zig_rate_history FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update usd_zig_rate_history"
  ON public.usd_zig_rate_history FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can read rm_cost_register" ON public.rm_cost_register;
DROP POLICY IF EXISTS "Authenticated users can insert rm_cost_register" ON public.rm_cost_register;
DROP POLICY IF EXISTS "Authenticated users can update rm_cost_register" ON public.rm_cost_register;
CREATE POLICY "Authenticated users can read rm_cost_register"
  ON public.rm_cost_register FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert rm_cost_register"
  ON public.rm_cost_register FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update rm_cost_register"
  ON public.rm_cost_register FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_rm_cost_register_material
  ON public.rm_cost_register(raw_material_id);
CREATE INDEX IF NOT EXISTS idx_rm_cost_register_date
  ON public.rm_cost_register(effective_date);
CREATE INDEX IF NOT EXISTS idx_usd_zig_rate_history_date
  ON public.usd_zig_rate_history(effective_date);
