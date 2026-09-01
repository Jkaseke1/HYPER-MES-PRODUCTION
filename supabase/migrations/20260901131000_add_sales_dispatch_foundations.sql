-- Production sales, dispatch-planning, and finished-goods transfer foundations.
-- Schema only: creates no customers, orders, bookings, reports, or transfers.
-- Sage integration: deliberately disabled. No sync_log writes or posting triggers are created.

CREATE TABLE IF NOT EXISTS public.sales_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text UNIQUE NOT NULL,
  customer_name text NOT NULL,
  customer_location text NOT NULL,
  customer_contact text,
  order_date date NOT NULL DEFAULT current_date,
  expected_delivery_date date NOT NULL,
  total_tonnage numeric NOT NULL DEFAULT 0,
  total_value numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  priority text NOT NULL DEFAULT 'normal',
  notes text,
  branch_id uuid REFERENCES public.branches(id),
  created_by uuid REFERENCES public.profiles(id),
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id uuid NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  formulation_id uuid REFERENCES public.formulations(id),
  product_code text NOT NULL,
  product_name text NOT NULL,
  quantity numeric NOT NULL,
  unit text NOT NULL DEFAULT 'kg',
  unit_price numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.daily_production_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date date NOT NULL,
  branch_id uuid REFERENCES public.branches(id),
  shift text NOT NULL,
  batch_number text,
  plant_name text NOT NULL,
  formulation_id uuid REFERENCES public.formulations(id),
  product_name text NOT NULL,
  daily_target numeric,
  quantity_produced numeric NOT NULL DEFAULT 0,
  quantity_sold numeric NOT NULL DEFAULT 0,
  vet_sales numeric NOT NULL DEFAULT 0,
  equipment_sales numeric NOT NULL DEFAULT 0,
  labour_force integer,
  status text NOT NULL DEFAULT 'active',
  downtime_hours numeric NOT NULL DEFAULT 0,
  downtime_reason text,
  notes text,
  reported_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_date, branch_id, shift, plant_name)
);

CREATE TABLE IF NOT EXISTS public.production_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_date date NOT NULL DEFAULT current_date,
  branch_id uuid REFERENCES public.branches(id),
  shift text NOT NULL,
  issue_type text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  title text NOT NULL,
  description text NOT NULL,
  affected_plant text,
  downtime_hours numeric,
  resolution text,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.profiles(id),
  reported_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pol_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_date date NOT NULL DEFAULT current_date,
  customer_name text NOT NULL,
  customer_location text NOT NULL,
  customer_contact text,
  quantity_booked integer NOT NULL,
  total_booked integer NOT NULL,
  expected_delivery_date date,
  status text NOT NULL DEFAULT 'booked',
  notes text,
  branch_id uuid REFERENCES public.branches(id),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.finished_goods_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number text UNIQUE NOT NULL,
  production_order_id uuid NOT NULL REFERENCES public.production_orders(id),
  formulation_id uuid NOT NULL REFERENCES public.formulations(id),
  quantity numeric NOT NULL,
  unit text NOT NULL DEFAULT 'kg',
  transfer_date date NOT NULL DEFAULT current_date,
  notes text,
  initiated_by uuid REFERENCES public.profiles(id),
  verified_quantity numeric,
  verified_bags numeric,
  production_verified_by uuid REFERENCES public.profiles(id),
  production_verified_at timestamptz,
  finance_verified_by uuid REFERENCES public.profiles(id),
  finance_verified_at timestamptz,
  status text NOT NULL DEFAULT 'pending_finance',
  sage_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pending_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type text,
  title text,
  requested_by uuid REFERENCES public.profiles(id),
  notes text,
  entity_type text,
  entity_id uuid,
  entity_number text,
  entity_name text,
  status text NOT NULL DEFAULT 'pending',
  created_by uuid REFERENCES public.profiles(id),
  branch_id uuid REFERENCES public.branches(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON public.sales_orders(status);
CREATE INDEX IF NOT EXISTS idx_sales_orders_expected_date ON public.sales_orders(expected_delivery_date);
CREATE INDEX IF NOT EXISTS idx_sales_order_items_order ON public.sales_order_items(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_daily_production_reports_date ON public.daily_production_reports(report_date);
CREATE INDEX IF NOT EXISTS idx_production_issues_date ON public.production_issues(issue_date);
CREATE INDEX IF NOT EXISTS idx_finished_goods_transfers_order ON public.finished_goods_transfers(production_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finished_goods_transfers_status ON public.finished_goods_transfers(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_status ON public.pending_approvals(status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_approvals_entity
  ON public.pending_approvals(entity_type, entity_id)
  WHERE entity_type IS NOT NULL AND entity_id IS NOT NULL;

DO $schema_security$
DECLARE
  relation_name text;
  policy_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'sales_orders', 'sales_order_items', 'daily_production_reports',
    'production_issues', 'pol_bookings', 'finished_goods_transfers',
    'pending_approvals'
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

NOTIFY pgrst, 'reload schema';
