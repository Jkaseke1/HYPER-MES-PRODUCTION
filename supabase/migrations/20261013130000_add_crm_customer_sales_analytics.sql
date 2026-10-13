-- PlantControl CRM customer health snapshot. Populated by a read-only Sage import.
CREATE TABLE IF NOT EXISTS public.crm_customer_sales_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_date date NOT NULL,
  sage_customer_code text NOT NULL,
  sage_customer_name text NOT NULL DEFAULT '',
  sales_channel text NOT NULL CHECK (sales_channel IN ('hq_invoiced', 'branch_pos')),
  document_count integer NOT NULL DEFAULT 0,
  total_sales_amount numeric(18,2) NOT NULL DEFAULT 0,
  source_read_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_date, sage_customer_code, sales_channel)
);

CREATE INDEX IF NOT EXISTS idx_crm_customer_sales_daily_customer_date
  ON public.crm_customer_sales_daily (sage_customer_code, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_crm_customer_sales_daily_date
  ON public.crm_customer_sales_daily (invoice_date DESC);

ALTER TABLE public.crm_customer_sales_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_customer_sales_daily_authenticated_select ON public.crm_customer_sales_daily;
CREATE POLICY crm_customer_sales_daily_authenticated_select
  ON public.crm_customer_sales_daily FOR SELECT TO authenticated USING (true);
NOTIFY pgrst, 'reload schema';
