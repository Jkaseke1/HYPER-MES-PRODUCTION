-- Controlled inbound transporter expenses. Claims are anchored to a signed
-- weighbridge ticket and its one linked GRN; they do not alter GRN approval,
-- Sage posting, or stock balances.

CREATE TABLE IF NOT EXISTS public.inbound_transporters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transporter_code text NOT NULL UNIQUE,
  name text NOT NULL,
  contact_name text,
  contact_phone text,
  default_currency text NOT NULL DEFAULT 'USD',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(transporter_code)) > 0),
  CHECK (length(btrim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS public.inbound_transport_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_number text NOT NULL UNIQUE,
  weigh_bridge_ticket_id uuid NOT NULL UNIQUE REFERENCES public.weigh_bridge_tickets(id),
  grn_id uuid NOT NULL UNIQUE REFERENCES public.goods_received_notes(id),
  transporter_id uuid NOT NULL REFERENCES public.inbound_transporters(id),
  net_mass_kg numeric(14,3) NOT NULL CHECK (net_mass_kg > 0),
  rate_per_tonne numeric(14,4) NOT NULL CHECK (rate_per_tonne >= 0),
  calculated_amount numeric(14,2) NOT NULL CHECK (calculated_amount >= 0),
  currency_code text NOT NULL DEFAULT 'USD',
  invoice_number text,
  waybill_reference text,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'paid', 'cancelled')),
  submitted_at timestamptz,
  submitted_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id),
  review_note text,
  paid_at timestamptz,
  paid_by uuid REFERENCES public.profiles(id),
  payment_reference text,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inbound_transport_claim_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.inbound_transport_claims(id) ON DELETE CASCADE,
  action text NOT NULL,
  from_status text,
  to_status text,
  note text,
  changed_by uuid REFERENCES public.profiles(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inbound_transport_claims_status ON public.inbound_transport_claims(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_transport_claims_transporter ON public.inbound_transport_claims(transporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_transport_history_claim ON public.inbound_transport_claim_history(claim_id, changed_at);

ALTER TABLE public.inbound_transporters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_transport_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_transport_claim_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inbound_transporters_read ON public.inbound_transporters;
DROP POLICY IF EXISTS inbound_transporters_manage ON public.inbound_transporters;
DROP POLICY IF EXISTS inbound_transport_claims_read ON public.inbound_transport_claims;
DROP POLICY IF EXISTS inbound_transport_claim_history_read ON public.inbound_transport_claim_history;

CREATE POLICY inbound_transporters_read ON public.inbound_transporters
  FOR SELECT TO authenticated USING (true);
CREATE POLICY inbound_transporters_manage ON public.inbound_transporters
  FOR ALL TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'md', 'finance', 'accountant', 'logistics', 'raw_material_manager', 'warehouse_manager']))
  WITH CHECK (public.has_mes_role(ARRAY['admin', 'md', 'finance', 'accountant', 'logistics', 'raw_material_manager', 'warehouse_manager']));
CREATE POLICY inbound_transport_claims_read ON public.inbound_transport_claims
  FOR SELECT TO authenticated USING (true);
CREATE POLICY inbound_transport_claim_history_read ON public.inbound_transport_claim_history
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.record_inbound_transport_claim_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.inbound_transport_claim_history (
    claim_id, action, from_status, to_status, note, changed_by
  ) VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'status_change' END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    CASE
      WHEN TG_OP = 'INSERT' THEN 'Claim created from signed weighbridge ticket.'
      WHEN NEW.status = 'submitted' THEN 'Claim submitted for Finance review.'
      WHEN NEW.status = 'approved' THEN coalesce(NEW.review_note, 'Approved by Finance.')
      WHEN NEW.status = 'rejected' THEN coalesce(NEW.review_note, 'Returned for correction.')
      WHEN NEW.status = 'paid' THEN coalesce(NEW.payment_reference, 'Payment recorded.')
      ELSE NULL
    END,
    auth.uid()
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inbound_transport_claim_history ON public.inbound_transport_claims;
CREATE TRIGGER trg_inbound_transport_claim_history
  AFTER INSERT OR UPDATE OF status ON public.inbound_transport_claims
  FOR EACH ROW EXECUTE FUNCTION public.record_inbound_transport_claim_history();

CREATE OR REPLACE FUNCTION public.next_inbound_transport_claim_number()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT 'ITC-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
$$;

CREATE OR REPLACE FUNCTION public.save_inbound_transport_claim(
  p_claim_id uuid,
  p_weigh_bridge_ticket_id uuid,
  p_transporter_id uuid,
  p_rate_per_tonne numeric,
  p_currency_code text,
  p_invoice_number text,
  p_waybill_reference text,
  p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.weigh_bridge_tickets%ROWTYPE;
  v_grn_id uuid;
  v_existing public.inbound_transport_claims%ROWTYPE;
  v_claim_id uuid;
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'md', 'logistics', 'raw_material_manager', 'warehouse_manager']) THEN
    RAISE EXCEPTION 'Only Logistics, Warehouse Management, or Admin can prepare a transport claim.';
  END IF;

  IF p_rate_per_tonne IS NULL OR p_rate_per_tonne < 0 THEN
    RAISE EXCEPTION 'Rate per tonne must be zero or greater.';
  END IF;

  SELECT * INTO v_ticket
  FROM public.weigh_bridge_tickets
  WHERE id = p_weigh_bridge_ticket_id
  FOR UPDATE;

  IF NOT FOUND OR NOT coalesce(v_ticket.driver_signed, false) OR coalesce(v_ticket.nett_mass, 0) <= 0 THEN
    RAISE EXCEPTION 'A signed weighbridge ticket with a positive net mass is required.';
  END IF;

  SELECT id INTO v_grn_id
  FROM public.goods_received_notes
  WHERE weigh_bridge_ticket_id = p_weigh_bridge_ticket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The weighbridge ticket must be linked to a GRN before a transport claim can be prepared.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.inbound_transporters WHERE id = p_transporter_id AND is_active) THEN
    RAISE EXCEPTION 'Select an active transporter.';
  END IF;

  IF p_claim_id IS NULL THEN
    INSERT INTO public.inbound_transport_claims (
      claim_number, weigh_bridge_ticket_id, grn_id, transporter_id, net_mass_kg,
      rate_per_tonne, calculated_amount, currency_code, invoice_number,
      waybill_reference, notes, created_by
    ) VALUES (
      public.next_inbound_transport_claim_number(), p_weigh_bridge_ticket_id, v_grn_id,
      p_transporter_id, v_ticket.nett_mass, p_rate_per_tonne,
      round((v_ticket.nett_mass / 1000) * p_rate_per_tonne, 2),
      upper(coalesce(nullif(btrim(p_currency_code), ''), 'USD')),
      nullif(btrim(p_invoice_number), ''), nullif(btrim(p_waybill_reference), ''),
      coalesce(p_notes, ''), auth.uid()
    ) RETURNING id INTO v_claim_id;
  ELSE
    SELECT * INTO v_existing FROM public.inbound_transport_claims WHERE id = p_claim_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Transport claim not found.'; END IF;
    IF v_existing.status NOT IN ('draft', 'rejected') THEN RAISE EXCEPTION 'Only draft or rejected claims can be changed.'; END IF;
    IF v_existing.created_by <> auth.uid() AND NOT public.has_mes_role(ARRAY['admin', 'md']) THEN
      RAISE EXCEPTION 'Only the claim creator or Admin can change this claim.';
    END IF;
    IF v_existing.weigh_bridge_ticket_id <> p_weigh_bridge_ticket_id THEN
      RAISE EXCEPTION 'The evidence ticket cannot be changed after a claim is created.';
    END IF;
    UPDATE public.inbound_transport_claims
    SET transporter_id = p_transporter_id,
        rate_per_tonne = p_rate_per_tonne,
        calculated_amount = round((v_ticket.nett_mass / 1000) * p_rate_per_tonne, 2),
        currency_code = upper(coalesce(nullif(btrim(p_currency_code), ''), 'USD')),
        invoice_number = nullif(btrim(p_invoice_number), ''),
        waybill_reference = nullif(btrim(p_waybill_reference), ''),
        notes = coalesce(p_notes, ''), review_note = NULL, updated_at = now()
    WHERE id = p_claim_id;
    v_claim_id := p_claim_id;
  END IF;
  RETURN v_claim_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_inbound_transport_claim(p_claim_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_claim public.inbound_transport_claims%ROWTYPE;
BEGIN
  SELECT * INTO v_claim FROM public.inbound_transport_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transport claim not found.'; END IF;
  IF NOT public.has_mes_role(ARRAY['admin', 'md', 'logistics', 'raw_material_manager', 'warehouse_manager']) THEN RAISE EXCEPTION 'You cannot submit a transport claim.'; END IF;
  IF v_claim.created_by <> auth.uid() AND NOT public.has_mes_role(ARRAY['admin', 'md']) THEN RAISE EXCEPTION 'Only the claim creator or Admin can submit this claim.'; END IF;
  IF v_claim.status NOT IN ('draft', 'rejected') THEN RAISE EXCEPTION 'Only draft or rejected claims can be submitted.'; END IF;
  IF v_claim.invoice_number IS NULL AND v_claim.waybill_reference IS NULL THEN RAISE EXCEPTION 'Add an invoice number or waybill reference before submission.'; END IF;
  UPDATE public.inbound_transport_claims
  SET status = 'submitted', submitted_at = now(), submitted_by = auth.uid(), updated_at = now()
  WHERE id = p_claim_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_inbound_transport_claim(p_claim_id uuid, p_approved boolean, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_claim public.inbound_transport_claims%ROWTYPE;
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'md', 'finance', 'accountant']) THEN RAISE EXCEPTION 'Only Finance, Accountant, or Admin can review a transport claim.'; END IF;
  SELECT * INTO v_claim FROM public.inbound_transport_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR v_claim.status <> 'submitted' THEN RAISE EXCEPTION 'Only submitted claims can be reviewed.'; END IF;
  IF v_claim.created_by = auth.uid() THEN RAISE EXCEPTION 'A claim cannot be approved or rejected by its creator.'; END IF;
  IF NOT p_approved AND nullif(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'A rejection reason is required.'; END IF;
  UPDATE public.inbound_transport_claims
  SET status = CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
      reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(p_note), ''), updated_at = now()
  WHERE id = p_claim_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_inbound_transport_claim_paid(p_claim_id uuid, p_payment_reference text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_claim public.inbound_transport_claims%ROWTYPE;
BEGIN
  IF NOT public.has_mes_role(ARRAY['admin', 'md', 'finance', 'accountant']) THEN RAISE EXCEPTION 'Only Finance, Accountant, or Admin can record payment.'; END IF;
  IF nullif(btrim(p_payment_reference), '') IS NULL THEN RAISE EXCEPTION 'A payment reference is required.'; END IF;
  SELECT * INTO v_claim FROM public.inbound_transport_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR v_claim.status <> 'approved' THEN RAISE EXCEPTION 'Only approved claims can be marked paid.'; END IF;
  UPDATE public.inbound_transport_claims
  SET status = 'paid', paid_by = auth.uid(), paid_at = now(), payment_reference = btrim(p_payment_reference), updated_at = now()
  WHERE id = p_claim_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_inbound_transport_claim(uuid, uuid, uuid, numeric, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_inbound_transport_claim(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_inbound_transport_claim(uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_inbound_transport_claim_paid(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_inbound_transport_claim(uuid, uuid, uuid, numeric, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_inbound_transport_claim(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_inbound_transport_claim(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_inbound_transport_claim_paid(uuid, text) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
