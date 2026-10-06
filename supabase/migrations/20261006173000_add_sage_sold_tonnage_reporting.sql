-- Power BI-aligned sales aggregate imported read-only from Hyperfeeds_Reporting.
CREATE TABLE IF NOT EXISTS public.sage_sold_tonnage_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_date date NOT NULL,
  warehouse_code text NOT NULL DEFAULT '', warehouse_name text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '', sub_category text NOT NULL DEFAULT '',
  reporting_category text NOT NULL DEFAULT '', transaction_type text NOT NULL,
  total_tonnes numeric(18,3) NOT NULL DEFAULT 0, total_sales_amount numeric(18,2) NOT NULL DEFAULT 0,
  line_count integer NOT NULL DEFAULT 0, imported_at timestamptz NOT NULL DEFAULT now(), source_read_at timestamptz,
  UNIQUE(invoice_date, warehouse_code, category, sub_category, reporting_category, transaction_type)
);
CREATE INDEX IF NOT EXISTS idx_sage_sold_tonnage_date ON public.sage_sold_tonnage_daily(invoice_date DESC);
ALTER TABLE public.sage_sold_tonnage_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sage_sold_tonnage_read ON public.sage_sold_tonnage_daily;
CREATE POLICY sage_sold_tonnage_read ON public.sage_sold_tonnage_daily FOR SELECT TO authenticated
USING (public.has_mes_role(ARRAY['admin','md','finance','accountant','production_manager','supervisor','logistics']));
NOTIFY pgrst, 'reload schema';
