-- Production extended chick-operation foundations.
-- Schema only: no branches, customers, routes, deliveries, alerts, mappings, or Sage rows.
-- No payment notification trigger and no Sage write integration are created.

CREATE TABLE IF NOT EXISTS public.chick_branches (
  branch_code text PRIMARY KEY,
  branch_name text NOT NULL,
  delivery_type text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chick_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.chick_purchase_orders(id) ON DELETE CASCADE,
  delivery_number text,
  delivery_date timestamptz NOT NULL DEFAULT now(),
  qty_received numeric NOT NULL DEFAULT 0,
  qty_rejected numeric NOT NULL DEFAULT 0,
  qty_accepted numeric GENERATED ALWAYS AS (qty_received - qty_rejected) STORED,
  batch_notes text NOT NULL DEFAULT '',
  received_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chick_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chick_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE,
  route_id uuid REFERENCES public.chick_routes(id),
  contact_person text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chick_distribution_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_ending date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chick_distribution_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.chick_distribution_schedules(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.chick_customers(id),
  delivery_date date NOT NULL,
  route_id uuid REFERENCES public.chick_routes(id),
  planned_qty integer NOT NULL DEFAULT 0,
  actual_qty integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  vehicle_ref text NOT NULL DEFAULT '',
  driver_name text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chick_payment_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.chick_supplier_invoices(id) ON DELETE CASCADE,
  po_id uuid REFERENCES public.chick_purchase_orders(id),
  alert_type text NOT NULL,
  channel text NOT NULL,
  recipient_email text,
  recipient_phone text,
  recipient_name text,
  recipient_role text,
  message_subject text,
  message_body text,
  status text NOT NULL DEFAULT 'PENDING',
  sent_at timestamptz,
  error_message text,
  triggered_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chick_delivery_notes
  ADD COLUMN IF NOT EXISTS sage_grv_number text,
  ADD COLUMN IF NOT EXISTS sage_dn_number text,
  ADD COLUMN IF NOT EXISTS sage_grv_status text,
  ADD COLUMN IF NOT EXISTS sage_grv_value_usd numeric,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

CREATE TABLE IF NOT EXISTS public.chick_dn_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_dnote text NOT NULL,
  sage_dn_number text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_dnote, sage_dn_number)
);

CREATE TABLE IF NOT EXISTS public.chick_sage_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_code text NOT NULL,
  invoice_date date NOT NULL,
  invoice_number text,
  item_code text NOT NULL,
  chicks_sold integer NOT NULL DEFAULT 0,
  revenue_usd numeric NOT NULL DEFAULT 0,
  unit_cost_usd numeric,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.fn_resolve_sage_dn(p_branch_dnote text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT COALESCE(
    (SELECT map.sage_dn_number FROM public.chick_dn_map map WHERE map.branch_dnote = p_branch_dnote LIMIT 1),
    p_branch_dnote
  );
$function$;

CREATE OR REPLACE VIEW public.v_chick_reconciliation AS
WITH ordered AS (
  SELECT
    line.branch_code,
    purchase_order.po_number,
    line.delivery_type,
    line.chick_type,
    SUM(line.booked_qty) AS ordered_qty
  FROM public.chick_po_lines line
  JOIN public.chick_purchase_orders purchase_order ON purchase_order.id = line.po_id
  GROUP BY line.branch_code, purchase_order.po_number, line.delivery_type, line.chick_type
), received AS (
  SELECT
    note.branch_code,
    note.dnote_number,
    note.quantity_allocated,
    note.quantity_received,
    note.variance,
    note.sage_grv_number,
    note.sage_dn_number,
    note.sage_grv_status,
    note.sage_grv_value_usd,
    note.reconciled_at,
    public.fn_resolve_sage_dn(note.dnote_number) AS resolved_sage_dn
  FROM public.chick_delivery_notes note
)
SELECT
  ordered.branch_code,
  ordered.po_number,
  received.dnote_number,
  received.resolved_sage_dn,
  ordered.delivery_type,
  ordered.chick_type,
  ordered.ordered_qty,
  COALESCE(received.quantity_allocated, 0) AS allocated_qty,
  COALESCE(received.quantity_received, 0) AS received_qty,
  COALESCE(received.variance, 0) AS variance,
  received.sage_grv_number,
  received.sage_dn_number,
  received.sage_grv_status,
  received.sage_grv_value_usd,
  COALESCE(received.quantity_received, 0) - ordered.ordered_qty AS variance_ordered_vs_received,
  CASE
    WHEN received.sage_grv_status = 'Unprocessed' THEN 'GRV_UNPROCESSED'
    WHEN received.sage_grv_number IS NULL AND received.quantity_received > 0 THEN 'GRV_MISSING'
    WHEN COALESCE(received.quantity_received, 0) = ordered.ordered_qty THEN 'MATCHED'
    WHEN COALESCE(received.quantity_received, 0) < ordered.ordered_qty THEN 'SHORT_DELIVERY'
    WHEN COALESCE(received.quantity_received, 0) > ordered.ordered_qty THEN 'OVER_DELIVERY'
    ELSE 'UNKNOWN'
  END AS status,
  received.reconciled_at,
  ordered.ordered_qty * 0.78 AS estimated_cost_usd
FROM ordered
LEFT JOIN received ON received.branch_code = ordered.branch_code;

CREATE OR REPLACE VIEW public.v_chick_grv_unprocessed AS
SELECT
  note.id AS delivery_note_id,
  note.branch_code,
  note.dnote_number,
  note.sage_dn_number,
  note.sage_grv_number,
  note.sage_grv_status,
  note.sage_grv_value_usd,
  note.quantity_received,
  note.declared_at,
  EXTRACT(day FROM (now() - note.declared_at)) AS age_days,
  supplier.name AS supplier,
  purchase_order.po_number
FROM public.chick_delivery_notes note
JOIN public.chick_supplier_consignments consignment ON consignment.id = note.consignment_id
JOIN public.chick_suppliers supplier ON supplier.id = consignment.supplier_id
LEFT JOIN public.chick_purchase_orders purchase_order ON purchase_order.id = consignment.po_id
WHERE note.sage_grv_status = 'Unprocessed'
   OR (note.quantity_received > 0 AND note.sage_grv_number IS NULL);

CREATE OR REPLACE VIEW public.v_chick_sales_unmatched AS
SELECT
  sale.branch_code,
  sale.invoice_date,
  sale.invoice_number,
  sale.item_code,
  sale.chicks_sold,
  sale.revenue_usd,
  sale.unit_cost_usd,
  true AS is_unmatched
FROM public.chick_sage_sales sale
WHERE NOT EXISTS (
  SELECT 1
  FROM public.chick_delivery_notes note
  WHERE note.branch_code = sale.branch_code
    AND (note.sage_dn_number = sale.invoice_number OR note.dnote_number = sale.invoice_number)
);

CREATE OR REPLACE VIEW public.v_chick_margin AS
SELECT
  branch_code,
  item_code,
  SUM(chicks_sold) AS total_chicks_sold,
  SUM(revenue_usd) AS total_revenue_usd,
  SUM(chicks_sold * COALESCE(unit_cost_usd, 0)) AS total_cost_usd,
  CASE WHEN SUM(chicks_sold) > 0 THEN ROUND(SUM(revenue_usd) / SUM(chicks_sold), 4) ELSE 0 END AS avg_sell_price,
  CASE WHEN SUM(chicks_sold) > 0 THEN ROUND(SUM(chicks_sold * COALESCE(unit_cost_usd, 0)) / SUM(chicks_sold), 4) ELSE 0 END AS avg_cost,
  CASE WHEN SUM(chicks_sold) > 0 THEN ROUND((SUM(revenue_usd) - SUM(chicks_sold * COALESCE(unit_cost_usd, 0))) / SUM(chicks_sold), 4) ELSE 0 END AS profit_per_chick,
  CASE WHEN SUM(revenue_usd) > 0 THEN ROUND((SUM(revenue_usd) - SUM(chicks_sold * COALESCE(unit_cost_usd, 0))) / SUM(revenue_usd) * 100, 2) ELSE 0 END AS margin_pct
FROM public.chick_sage_sales
GROUP BY branch_code, item_code;

CREATE INDEX IF NOT EXISTS idx_chick_deliveries_po ON public.chick_deliveries(po_id);
CREATE INDEX IF NOT EXISTS idx_chick_distribution_lines_schedule ON public.chick_distribution_lines(schedule_id);
CREATE INDEX IF NOT EXISTS idx_chick_distribution_lines_date ON public.chick_distribution_lines(delivery_date);
CREATE INDEX IF NOT EXISTS idx_chick_payment_alerts_invoice ON public.chick_payment_alerts(invoice_id);
CREATE INDEX IF NOT EXISTS idx_chick_payment_alerts_status ON public.chick_payment_alerts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chick_sage_sales_branch_date ON public.chick_sage_sales(branch_code, invoice_date DESC);

DO $schema_security$
DECLARE
  relation_name text;
  policy_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'chick_branches', 'chick_deliveries', 'chick_routes', 'chick_customers',
    'chick_distribution_schedules', 'chick_distribution_lines',
    'chick_payment_alerts', 'chick_dn_map', 'chick_sage_sales'
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

GRANT SELECT ON public.v_chick_reconciliation TO authenticated;
GRANT SELECT ON public.v_chick_grv_unprocessed TO authenticated;
GRANT SELECT ON public.v_chick_sales_unmatched TO authenticated;
GRANT SELECT ON public.v_chick_margin TO authenticated;
NOTIFY pgrst, 'reload schema';
