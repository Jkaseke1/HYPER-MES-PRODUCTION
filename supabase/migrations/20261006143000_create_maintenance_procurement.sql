-- Controlled maintenance procurement. Sage is deliberately read-only for this module.

CREATE TABLE IF NOT EXISTS public.maintenance_procurement_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text UNIQUE NOT NULL,
  work_order_id uuid REFERENCES public.maintenance_work_orders(id),
  title text NOT NULL,
  business_reason text NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('critical', 'high', 'normal', 'low')),
  required_by date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'quoting', 'pending_approval', 'approved', 'po_issued', 'received', 'part_paid', 'paid', 'rejected', 'cancelled')),
  currency_code text NOT NULL DEFAULT 'USD',
  approved_amount numeric(18,2),
  selected_supplier_name text,
  selected_supplier_account text,
  selection_reason text,
  plantcontrol_reference text UNIQUE NOT NULL,
  submitted_at timestamptz,
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.maintenance_procurement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.maintenance_procurement_requests(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  description text NOT NULL,
  specification text,
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'each',
  estimated_unit_cost numeric(18,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, line_number)
);

CREATE TABLE IF NOT EXISTS public.maintenance_procurement_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.maintenance_procurement_requests(id) ON DELETE CASCADE,
  supplier_name text NOT NULL,
  sage_supplier_account text,
  quote_reference text NOT NULL,
  quote_date date,
  valid_until date,
  currency_code text NOT NULL DEFAULT 'USD',
  quote_total numeric(18,2) NOT NULL CHECK (quote_total >= 0),
  attachment_path text,
  submitted_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, supplier_name, quote_reference)
);

CREATE TABLE IF NOT EXISTS public.maintenance_procurement_sage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.maintenance_procurement_requests(id) ON DELETE CASCADE,
  transaction_date date NOT NULL,
  supplier_account text NOT NULL,
  transaction_type text NOT NULL,
  reference text,
  audit_number text NOT NULL,
  charge_amount numeric(18,2) NOT NULL DEFAULT 0,
  payment_amount numeric(18,2) NOT NULL DEFAULT 0,
  outstanding_amount numeric(18,2) NOT NULL DEFAULT 0,
  sage_user text,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, audit_number, transaction_type)
);

CREATE TABLE IF NOT EXISTS public.maintenance_procurement_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.maintenance_procurement_requests(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  recipient text NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'failed')),
  provider_message_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_maintenance_procurement_status ON public.maintenance_procurement_requests(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_procurement_reference ON public.maintenance_procurement_requests(plantcontrol_reference);
CREATE INDEX IF NOT EXISTS idx_maintenance_procurement_sage_request ON public.maintenance_procurement_sage_history(request_id);

CREATE SEQUENCE IF NOT EXISTS public.maintenance_procurement_reference_seq START 1;

CREATE OR REPLACE FUNCTION public.maintenance_procurement_set_defaults()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.plantcontrol_reference IS NULL OR btrim(NEW.plantcontrol_reference) = '' THEN
    NEW.plantcontrol_reference := 'MPR-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.maintenance_procurement_reference_seq')::text, 6, '0');
  END IF;
  IF NEW.request_number IS NULL OR btrim(NEW.request_number) = '' THEN NEW.request_number := NEW.plantcontrol_reference; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_maintenance_procurement_defaults ON public.maintenance_procurement_requests;
CREATE TRIGGER trg_maintenance_procurement_defaults BEFORE INSERT OR UPDATE ON public.maintenance_procurement_requests
FOR EACH ROW EXECUTE FUNCTION public.maintenance_procurement_set_defaults();

ALTER TABLE public.maintenance_procurement_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_procurement_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_procurement_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_procurement_sage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_procurement_notifications ENABLE ROW LEVEL SECURITY;

DO $policies$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['maintenance_procurement_requests','maintenance_procurement_items','maintenance_procurement_quotes','maintenance_procurement_sage_history','maintenance_procurement_notifications'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS maintenance_procurement_read ON public.%I', t);
    EXECUTE format('CREATE POLICY maintenance_procurement_read ON public.%I FOR SELECT TO authenticated USING (public.has_mes_role(ARRAY[''admin'',''md'',''maintenance_tech'',''procurement'',''finance'',''accountant'']))', t);
  END LOOP;
END $policies$;

CREATE POLICY maintenance_procurement_request_write ON public.maintenance_procurement_requests FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid() AND public.has_mes_role(ARRAY['admin','md','maintenance_tech','procurement']));
CREATE POLICY maintenance_procurement_request_update ON public.maintenance_procurement_requests FOR UPDATE TO authenticated
USING (public.has_mes_role(ARRAY['admin','md','maintenance_tech','procurement']))
WITH CHECK (public.has_mes_role(ARRAY['admin','md','maintenance_tech','procurement']));
CREATE POLICY maintenance_procurement_item_write ON public.maintenance_procurement_items FOR ALL TO authenticated
USING (public.has_mes_role(ARRAY['admin','md','maintenance_tech','procurement'])) WITH CHECK (public.has_mes_role(ARRAY['admin','md','maintenance_tech','procurement']));
CREATE POLICY maintenance_procurement_quote_write ON public.maintenance_procurement_quotes FOR ALL TO authenticated
USING (public.has_mes_role(ARRAY['admin','md','procurement'])) WITH CHECK (public.has_mes_role(ARRAY['admin','md','procurement']));

-- These states are evidence-led. A user cannot simply call a request "paid".
CREATE OR REPLACE FUNCTION public.validate_maintenance_procurement_payment_status()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_charges numeric(18,2);
  v_payments numeric(18,2);
BEGIN
  IF NEW.status NOT IN ('part_paid', 'paid') THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(sum(charge_amount), 0), coalesce(sum(payment_amount), 0)
  INTO v_charges, v_payments
  FROM public.maintenance_procurement_sage_history
  WHERE request_id = NEW.id;

  IF v_charges <= 0 OR v_payments <= 0 THEN
    RAISE EXCEPTION 'A Sage charge and payment record are required before setting a payment status';
  END IF;
  IF NEW.status = 'paid' AND v_payments + 0.01 < v_charges THEN
    RAISE EXCEPTION 'Sage payment total is below the imported charge total';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_maintenance_procurement_payment_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_charges numeric(18,2);
  v_payments numeric(18,2);
BEGIN
  SELECT coalesce(sum(charge_amount), 0), coalesce(sum(payment_amount), 0)
  INTO v_charges, v_payments
  FROM public.maintenance_procurement_sage_history
  WHERE request_id = NEW.request_id;

  IF v_charges > 0 AND v_payments > 0 THEN
    UPDATE public.maintenance_procurement_requests
    SET status = CASE WHEN v_payments + 0.01 >= v_charges THEN 'paid' ELSE 'part_paid' END
    WHERE id = NEW.request_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_maintenance_procurement_payment_status ON public.maintenance_procurement_requests;
CREATE TRIGGER trg_validate_maintenance_procurement_payment_status
BEFORE UPDATE OF status ON public.maintenance_procurement_requests
FOR EACH ROW EXECUTE FUNCTION public.validate_maintenance_procurement_payment_status();

DROP TRIGGER IF EXISTS trg_refresh_maintenance_procurement_payment_status ON public.maintenance_procurement_sage_history;
CREATE TRIGGER trg_refresh_maintenance_procurement_payment_status
AFTER INSERT OR UPDATE OF charge_amount, payment_amount ON public.maintenance_procurement_sage_history
FOR EACH ROW EXECUTE FUNCTION public.refresh_maintenance_procurement_payment_status();

NOTIFY pgrst, 'reload schema';
