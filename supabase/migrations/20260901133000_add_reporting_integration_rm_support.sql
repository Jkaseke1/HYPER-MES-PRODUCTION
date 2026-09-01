-- Production reporting, integration-ledger, packaging-stock, and RM-lot support.
-- Schema only: no reports, integrations, imports, stock, lots, or reconciliation rows.
-- No gateway, Sage import, lot backfill, or stock-recalculation trigger is activated.

CREATE TABLE IF NOT EXISTS public.monthly_rm_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  warehouse text NOT NULL,
  material_type text NOT NULL,
  material_id uuid REFERENCES public.raw_materials(id),
  material_name text NOT NULL,
  opening_stock_kg numeric,
  receipts_kg numeric,
  issues_kg numeric,
  expected_closing_kg numeric,
  physical_count_kg numeric,
  system_stock_kg numeric,
  variance_kg numeric GENERATED ALWAYS AS (physical_count_kg - system_stock_kg) STORED,
  variance_pct numeric,
  variance_reason_code text,
  variance_comment text,
  reconciliation_status text NOT NULL DEFAULT 'OPEN',
  submitted_by uuid REFERENCES public.profiles(id),
  submitted_at timestamptz,
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS public.packaging_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packaging_sku_id uuid NOT NULL UNIQUE REFERENCES public.packaging_skus(id) ON DELETE CASCADE,
  quantity_bags numeric NOT NULL DEFAULT 0,
  reorder_level numeric NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.raw_material_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  grn_id uuid REFERENCES public.goods_received_notes(id) ON DELETE SET NULL,
  grn_item_id uuid UNIQUE REFERENCES public.grn_items(id) ON DELETE SET NULL,
  batch_number text NOT NULL,
  qty_received numeric NOT NULL DEFAULT 0,
  qty_remaining numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'kg',
  unit_cost numeric NOT NULL DEFAULT 0,
  received_date date NOT NULL DEFAULT current_date,
  expiry_date date,
  warehouse_id uuid REFERENCES public.warehouses(id),
  source text NOT NULL DEFAULT 'grn',
  status text NOT NULL DEFAULT 'active',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (qty_received >= 0),
  CHECK (qty_remaining >= 0)
);

CREATE OR REPLACE VIEW public.v_rm_available_lots AS
SELECT
  lot.id AS lot_id,
  lot.raw_material_id,
  material.code AS material_code,
  material.name AS material_name,
  lot.batch_number,
  lot.qty_remaining,
  lot.unit,
  lot.unit_cost,
  lot.received_date,
  lot.expiry_date,
  lot.source,
  lot.grn_id,
  grn.grn_number
FROM public.raw_material_lots lot
JOIN public.raw_materials material ON material.id = lot.raw_material_id
LEFT JOIN public.goods_received_notes grn ON grn.id = lot.grn_id
WHERE lot.status = 'active' AND lot.qty_remaining > 0;

CREATE TABLE IF NOT EXISTS public.plant_integration_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text UNIQUE NOT NULL,
  name text NOT NULL,
  provider text NOT NULL DEFAULT 'custom',
  integration_type text NOT NULL DEFAULT 'api',
  endpoint_url text,
  authentication_method text NOT NULL DEFAULT 'gateway_secret',
  polling_interval_seconds integer,
  enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'not_configured',
  last_seen_at timestamptz,
  last_error text,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.plant_integration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.plant_integration_sources(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  production_order_id uuid REFERENCES public.production_orders(id) ON DELETE SET NULL,
  machine_id uuid REFERENCES public.machines(id) ON DELETE SET NULL,
  batch_number text,
  processing_status text NOT NULL DEFAULT 'received',
  processing_error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz,
  UNIQUE (source_id, event_key)
);

CREATE TABLE IF NOT EXISTS public.management_report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  report_type text NOT NULL,
  frequency text NOT NULL,
  delivery_time time NOT NULL DEFAULT '07:00',
  recipients text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.management_report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES public.management_report_schedules(id) ON DELETE SET NULL,
  report_type text NOT NULL,
  period_start date,
  period_end date,
  status text NOT NULL DEFAULT 'queued',
  delivery_channel text NOT NULL DEFAULT 'gateway',
  recipient_count integer NOT NULL DEFAULT 0,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sage_imported_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sage_transaction_key text UNIQUE NOT NULL,
  sage_source_database text,
  transaction_type text NOT NULL,
  transaction_date timestamptz NOT NULL,
  item_code text NOT NULL,
  item_description text,
  warehouse_code text,
  counter_warehouse_code text,
  quantity_in numeric NOT NULL DEFAULT 0,
  quantity_out numeric NOT NULL DEFAULT 0,
  unit_cost numeric,
  reference text,
  description text,
  source_document_type text,
  source_document_number text,
  mes_reference_type text,
  mes_reference_id uuid,
  import_status text NOT NULL DEFAULT 'imported',
  import_error text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monthly_rm_reconciliation_period ON public.monthly_rm_reconciliation(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_monthly_rm_reconciliation_status ON public.monthly_rm_reconciliation(reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_raw_material_lots_material ON public.raw_material_lots(raw_material_id, status, received_date);
CREATE INDEX IF NOT EXISTS idx_plant_integration_events_received ON public.plant_integration_events(source_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_management_report_schedules_enabled ON public.management_report_schedules(enabled, frequency);
CREATE INDEX IF NOT EXISTS idx_sage_imported_transactions_date ON public.sage_imported_transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_sage_imported_transactions_item ON public.sage_imported_transactions(item_code, transaction_date DESC);

DO $schema_security$
DECLARE
  relation_name text;
  policy_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'monthly_rm_reconciliation', 'packaging_stock', 'raw_material_lots',
    'plant_integration_sources', 'plant_integration_events',
    'management_report_schedules', 'management_report_runs',
    'sage_imported_transactions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    policy_name := 'Authenticated users manage ' || relation_name;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, relation_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      policy_name,
      relation_name
    );
  END LOOP;
END
$schema_security$;

GRANT SELECT ON public.v_rm_available_lots TO authenticated;
NOTIFY pgrst, 'reload schema';
