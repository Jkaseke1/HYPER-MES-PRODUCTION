-- Production and packaging workflow foundations.
-- This migration creates empty structures only. It does not import UAT formulas,
-- packaging masters, production orders, stock, Sage data, or transaction history.

CREATE TABLE IF NOT EXISTS public.packaging_skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_code text UNIQUE NOT NULL,
  description text NOT NULL,
  bag_size_kg numeric(10,2),
  is_active boolean NOT NULL DEFAULT true,
  sage_stock_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.batch_packaging_used (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  packaging_sku_id uuid NOT NULL REFERENCES public.packaging_skus(id),
  bags_used integer NOT NULL CHECK (bags_used > 0),
  implied_tonnes numeric(14,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id)
);

CREATE TABLE IF NOT EXISTS public.period_production_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date,
  period_end date,
  product_id uuid REFERENCES public.formulations(id) ON DELETE SET NULL,
  formulation_version text,
  tonnes_produced numeric(14,4),
  rm_cost_per_mt_usd numeric(12,4),
  sell_price_per_mt_usd numeric(12,4),
  margin_per_mt_usd numeric(12,4),
  total_margin_usd numeric(14,4),
  margin_pct numeric(8,4),
  usd_zig_rate numeric(10,4),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.macropack_bom_packaging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id uuid NOT NULL REFERENCES public.macropack_boms(id) ON DELETE CASCADE,
  item_code text NOT NULL,
  description text NOT NULL,
  unit text NOT NULL DEFAULT 'units',
  expected_qty_per_unit numeric NOT NULL DEFAULT 0 CHECK (expected_qty_per_unit >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.macropack_packaging_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.macropack_manufacture_orders(id) ON DELETE CASCADE,
  item_code text NOT NULL,
  description text NOT NULL,
  expected_qty numeric,
  actual_qty numeric NOT NULL CHECK (actual_qty >= 0),
  variance_qty numeric GENERATED ALWAYS AS (actual_qty - expected_qty) STORED,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.production_bom_packaging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formulation_id uuid NOT NULL REFERENCES public.formulations(id) ON DELETE CASCADE,
  packaging_sku_id uuid REFERENCES public.packaging_skus(id) ON DELETE SET NULL,
  item_code text NOT NULL,
  description text NOT NULL,
  unit text NOT NULL DEFAULT 'units',
  expected_qty_per_tonne numeric NOT NULL DEFAULT 0 CHECK (expected_qty_per_tonne >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.production_bom_packaging
  ADD COLUMN IF NOT EXISTS packaging_sku_id uuid REFERENCES public.packaging_skus(id) ON DELETE SET NULL;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS labour_force integer,
  ADD COLUMN IF NOT EXISTS yield_percentage numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS process_loss_percentage numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS process_loss_qty numeric NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.production_order_downtime (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  downtime_hours numeric(8,2) NOT NULL CHECK (downtime_hours >= 0),
  category text NOT NULL CHECK (category IN (
    'Mechanical', 'Electrical', 'Power Outage',
    'Waiting - Materials', 'Waiting - Maintenance', 'Other'
  )),
  reason text NOT NULL,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.operation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  default_estimated_time_mins integer NOT NULL DEFAULT 60 CHECK (default_estimated_time_mins >= 0),
  default_prep_time_mins integer NOT NULL DEFAULT 15 CHECK (default_prep_time_mins >= 0),
  seq_no integer NOT NULL DEFAULT 1 CHECK (seq_no > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.production_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  seq_no integer NOT NULL DEFAULT 1 CHECK (seq_no > 0),
  operation_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  workstation_id uuid REFERENCES public.machines(id) ON DELETE SET NULL,
  estimated_time_mins integer NOT NULL DEFAULT 0 CHECK (estimated_time_mins >= 0),
  prep_time_mins integer NOT NULL DEFAULT 0 CHECK (prep_time_mins >= 0),
  planned_qty numeric NOT NULL DEFAULT 0,
  actual_start timestamptz,
  actual_end timestamptz,
  actual_time_mins integer NOT NULL DEFAULT 0 CHECK (actual_time_mins >= 0),
  actual_qty numeric NOT NULL DEFAULT 0,
  rejected_qty numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  operator_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  supervisor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.production_notice_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_notice_id uuid NOT NULL REFERENCES public.production_notices(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  file_size integer NOT NULL CHECK (file_size >= 0),
  file_type text,
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_batch_packaging_used_order ON public.batch_packaging_used(production_order_id);
CREATE INDEX IF NOT EXISTS idx_batch_packaging_used_sku ON public.batch_packaging_used(packaging_sku_id);
CREATE INDEX IF NOT EXISTS idx_period_production_summary_dates ON public.period_production_summary(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_macropack_bom_packaging_bom ON public.macropack_bom_packaging(bom_id);
CREATE INDEX IF NOT EXISTS idx_macropack_packaging_issues_order ON public.macropack_packaging_issues(order_id);
CREATE INDEX IF NOT EXISTS idx_production_bom_packaging_formulation ON public.production_bom_packaging(formulation_id);
CREATE INDEX IF NOT EXISTS idx_production_order_downtime_order ON public.production_order_downtime(production_order_id);
CREATE INDEX IF NOT EXISTS idx_production_operations_order ON public.production_operations(production_order_id);
CREATE INDEX IF NOT EXISTS idx_production_operations_status ON public.production_operations(status);
CREATE INDEX IF NOT EXISTS idx_production_notice_attachments_notice ON public.production_notice_attachments(production_notice_id);

ALTER TABLE public.packaging_skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_packaging_used ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.period_production_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.macropack_bom_packaging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.macropack_packaging_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_bom_packaging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_order_downtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_notice_attachments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'packaging_skus', 'batch_packaging_used', 'period_production_summary',
    'macropack_bom_packaging', 'macropack_packaging_issues', 'production_bom_packaging',
    'production_order_downtime', 'operation_templates', 'production_operations'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can manage %1$s" ON public.%1$I', table_name);
    EXECUTE format('CREATE POLICY "Authenticated users can manage %1$s" ON public.%1$I FOR ALL TO authenticated USING (true) WITH CHECK (true)', table_name);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Authenticated users can read production notice attachments" ON public.production_notice_attachments;
DROP POLICY IF EXISTS "Authenticated users can add production notice attachments" ON public.production_notice_attachments;
DROP POLICY IF EXISTS "Uploaders can delete production notice attachments" ON public.production_notice_attachments;

CREATE POLICY "Authenticated users can read production notice attachments"
  ON public.production_notice_attachments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can add production notice attachments"
  ON public.production_notice_attachments FOR INSERT TO authenticated WITH CHECK (uploaded_by = auth.uid());
CREATE POLICY "Uploaders can delete production notice attachments"
  ON public.production_notice_attachments FOR DELETE TO authenticated USING (uploaded_by = auth.uid());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'production-notice-attachments',
  'production-notice-attachments',
  false,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Production notice attachment uploads" ON storage.objects;
DROP POLICY IF EXISTS "Production notice attachment reads" ON storage.objects;
DROP POLICY IF EXISTS "Production notice attachment deletes" ON storage.objects;

CREATE POLICY "Production notice attachment uploads"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'production-notice-attachments');
CREATE POLICY "Production notice attachment reads"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'production-notice-attachments');
CREATE POLICY "Production notice attachment deletes"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'production-notice-attachments' AND owner = auth.uid());

CREATE OR REPLACE FUNCTION public.calc_production_yield()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.planned_qty > 0 AND NEW.actual_qty IS NOT NULL THEN
    NEW.yield_percentage := ROUND((NEW.actual_qty / NEW.planned_qty) * 100, 2);
    NEW.process_loss_qty := NEW.planned_qty - NEW.actual_qty - COALESCE(NEW.wastage_qty, 0) - COALESCE(NEW.rejected_qty, 0);
    NEW.process_loss_percentage := ROUND((NEW.process_loss_qty / NEW.planned_qty) * 100, 2);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calc_yield ON public.production_orders;
CREATE TRIGGER trg_calc_yield
  BEFORE UPDATE OF actual_qty, planned_qty, wastage_qty, rejected_qty ON public.production_orders
  FOR EACH ROW EXECUTE FUNCTION public.calc_production_yield();
