-- Provisional transporters are operational capture records, not Sage accounts.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.inbound_transporters
  ADD COLUMN IF NOT EXISTS sage_registration_status text NOT NULL DEFAULT 'legacy'
    CHECK (sage_registration_status IN ('legacy', 'pending', 'verified')),
  ADD COLUMN IF NOT EXISTS registration_note text,
  ADD COLUMN IF NOT EXISTS registration_audit jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.register_pending_transporter(p_name text, p_phone text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_id uuid; v_name text := btrim(p_name); v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF coalesce(v_role, '') NOT IN ('admin','raw_material_manager','rm_manager','weighbridge','weigh_bridge') THEN
    RAISE EXCEPTION 'Only authorised receiving staff may capture a new transporter.' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL OR length(v_name) NOT BETWEEN 3 AND 160 OR length(coalesce(p_phone,'')) > 50 OR length(coalesce(p_note,'')) > 500 THEN
    RAISE EXCEPTION 'Enter a transporter name of 3-160 characters, phone up to 50 and note up to 500 characters.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('pending_transporter'), hashtext(lower(v_name)));
  SELECT id INTO v_id FROM public.inbound_transporters
  WHERE is_active AND lower(btrim(name)) = lower(v_name)
    ORDER BY created_at LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  v_id := gen_random_uuid();
  INSERT INTO public.inbound_transporters(id, transporter_code, name, contact_phone, default_currency,
    is_active, created_by, sage_registration_status, registration_note, registration_audit)
  VALUES (v_id, 'NEW-' || upper(replace(v_id::text, '-', '')), v_name, nullif(btrim(p_phone),''), 'USD',
    true, auth.uid(), 'pending', nullif(btrim(p_note),''),
    jsonb_build_array(jsonb_build_object('action','captured','by',auth.uid(),'at',now(),'name',v_name)));
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.register_pending_transporter(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_pending_transporter(text,text,text) TO authenticated;

-- Attach only before a GRN or freight claim exists. Never silently rewrite posted evidence.
CREATE OR REPLACE FUNCTION public.set_ticket_transporter_before_grn(p_ticket_id uuid, p_transporter_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_role text; v_transporter public.inbound_transporters%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF coalesce(v_role,'') NOT IN ('admin','raw_material_manager','rm_manager') THEN
    RAISE EXCEPTION 'Only Raw Materials or Admin may complete the GRN transporter.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.weigh_bridge_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Weighbridge ticket not found.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.weigh_bridge_tickets WHERE id = p_ticket_id AND inbound_transport_mode = 'company_hired') THEN
    RAISE EXCEPTION 'Weighbridge must select company-hired transport first. Raw Materials cannot change the transport option.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.goods_received_notes WHERE weigh_bridge_ticket_id = p_ticket_id)
     OR EXISTS (SELECT 1 FROM public.inbound_transport_claims WHERE weigh_bridge_ticket_id = p_ticket_id) THEN
    RAISE EXCEPTION 'Transporter is locked after this ticket is linked to a GRN or freight claim.';
  END IF;
  SELECT * INTO v_transporter FROM public.inbound_transporters WHERE id = p_transporter_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active transporter.'; END IF;
  UPDATE public.weigh_bridge_tickets SET
    inbound_transporter_id = v_transporter.id, haulier_code = v_transporter.transporter_code,
    inbound_currency_code = v_transporter.default_currency WHERE id = p_ticket_id;
  UPDATE public.inbound_transporters SET registration_audit = registration_audit ||
    jsonb_build_array(jsonb_build_object('action','ticket_linked','ticket',p_ticket_id,'by',auth.uid(),'at',now()))
    WHERE id = p_transporter_id AND sage_registration_status = 'pending';
END; $$;
REVOKE ALL ON FUNCTION public.set_ticket_transporter_before_grn(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_ticket_transporter_before_grn(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_pending_transporter(p_transporter_id uuid, p_supplier_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_role text; v_supplier public.suppliers%ROWTYPE; v_transporter public.inbound_transporters%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF coalesce(v_role,'') NOT IN ('admin','finance','accountant') THEN
    RAISE EXCEPTION 'Only Finance, Accountant or Admin may verify the Sage transporter account.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_transporter FROM public.inbound_transporters WHERE id = p_transporter_id AND is_active FOR UPDATE;
  IF NOT FOUND OR v_transporter.sage_registration_status <> 'pending' THEN RAISE EXCEPTION 'This transporter is not awaiting registration.'; END IF;
  SELECT * INTO v_supplier FROM public.suppliers WHERE id = p_supplier_id AND is_active;
  IF NOT FOUND OR nullif(btrim(v_supplier.sage_code),'') IS NULL THEN
    RAISE EXCEPTION 'Select an active supplier imported from Sage. Register/import the Sage account first.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.inbound_transporters WHERE id <> p_transporter_id AND is_active
    AND upper(btrim(sage_supplier_account)) = upper(btrim(v_supplier.sage_code))) THEN
    RAISE EXCEPTION 'That Sage supplier is already linked to another transporter. Review the duplicate with Admin.';
  END IF;
  UPDATE public.inbound_transporters SET sage_registration_status = 'verified',
    sage_supplier_account = btrim(v_supplier.sage_code), updated_at = now(),
    registration_audit = registration_audit || jsonb_build_array(jsonb_build_object(
      'action','sage_link_verified','by',auth.uid(),'at',now(),'supplier_id',v_supplier.id,
      'sage_supplier_account',v_supplier.sage_code,'supplier_name',v_supplier.name))
  WHERE id = p_transporter_id;
END; $$;
REVOKE ALL ON FUNCTION public.resolve_pending_transporter(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_pending_transporter(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_inbound_transporters_for_weighbridge()
RETURNS TABLE(id uuid, transporter_code text, name text, default_currency text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()
    AND role IN ('admin','raw_material_manager','rm_manager','weighbridge','weigh_bridge')) THEN
    RAISE EXCEPTION 'Only authorised receiving staff may view the operational transporter list.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT t.id,
    CASE WHEN t.sage_registration_status = 'verified' THEN coalesce(t.sage_supplier_account,t.transporter_code) ELSE t.transporter_code END,
    t.name, t.default_currency FROM public.inbound_transporters t WHERE t.is_active ORDER BY t.name;
END; $$;
REVOKE ALL ON FUNCTION public.list_inbound_transporters_for_weighbridge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_inbound_transporters_for_weighbridge() TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_transporter_registration_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF OLD.sage_registration_status = 'pending' AND (
    NEW.sage_registration_status IS DISTINCT FROM OLD.sage_registration_status
    OR NEW.sage_supplier_account IS DISTINCT FROM OLD.sage_supplier_account
  ) AND auth.role() IS DISTINCT FROM 'service_role' AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','finance','accountant')
  ) THEN
    RAISE EXCEPTION 'Only Finance may resolve a pending transporter account.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_transporter_registration_changes() FROM PUBLIC;
DROP TRIGGER IF EXISTS guard_transporter_registration_changes ON public.inbound_transporters;
CREATE TRIGGER guard_transporter_registration_changes BEFORE UPDATE ON public.inbound_transporters
FOR EACH ROW EXECUTE FUNCTION public.guard_transporter_registration_changes();

CREATE OR REPLACE FUNCTION public.guard_linked_ticket_transporter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF (NEW.inbound_transporter_id IS DISTINCT FROM OLD.inbound_transporter_id
    OR NEW.inbound_transport_mode IS DISTINCT FROM OLD.inbound_transport_mode)
    AND EXISTS (SELECT 1 FROM public.goods_received_notes WHERE weigh_bridge_ticket_id = OLD.id) THEN
    RAISE EXCEPTION 'The transporter is locked after linking the weighbridge ticket to a GRN.';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_linked_ticket_transporter() FROM PUBLIC;
DROP TRIGGER IF EXISTS guard_linked_ticket_transporter ON public.weigh_bridge_tickets;
CREATE TRIGGER guard_linked_ticket_transporter BEFORE UPDATE OF inbound_transporter_id, inbound_transport_mode ON public.weigh_bridge_tickets
FOR EACH ROW EXECUTE FUNCTION public.guard_linked_ticket_transporter();

-- Narrow Finance visibility: registration details only, no freight rates/payments.
CREATE OR REPLACE VIEW public.grn_transporter_registration AS
SELECT g.id AS grn_id, t.id AS ticket_id, t.inbound_transport_mode,
  tr.id AS transporter_id, tr.name AS transporter_name, tr.contact_phone,
  tr.registration_note, tr.sage_supplier_account,
  CASE WHEN t.inbound_transport_mode = 'company_hired' THEN coalesce(tr.sage_registration_status,'missing')
       ELSE 'not_required' END AS registration_status
FROM public.goods_received_notes g
LEFT JOIN public.weigh_bridge_tickets t ON t.id = g.weigh_bridge_ticket_id
LEFT JOIN public.inbound_transporters tr ON tr.id = t.inbound_transporter_id
WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
  AND p.role IN ('admin','finance','accountant','finance_viewer','md','raw_material_manager','rm_manager','warehouse_manager','weighbridge','weigh_bridge'));
REVOKE ALL ON public.grn_transporter_registration FROM PUBLIC, anon;
GRANT SELECT ON public.grn_transporter_registration TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_grn_pending_transporter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_transporter_id uuid; v_mode text; v_status text;
BEGIN
  IF NEW.status <> 'approved' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'approved' THEN RETURN NEW; END IF;
  END IF;
  SELECT inbound_transporter_id, inbound_transport_mode INTO v_transporter_id, v_mode
    FROM public.weigh_bridge_tickets WHERE id = NEW.weigh_bridge_ticket_id FOR UPDATE;
  IF v_mode = 'company_hired' THEN
    SELECT sage_registration_status INTO v_status FROM public.inbound_transporters
      WHERE id = v_transporter_id AND is_active FOR UPDATE;
    IF v_status IS NULL OR v_status = 'pending' THEN
      RAISE EXCEPTION 'GRN approval blocked: Finance must register and link the new transporter in Sage first.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_grn_pending_transporter() FROM PUBLIC;
DROP TRIGGER IF EXISTS guard_grn_pending_transporter ON public.goods_received_notes;
CREATE TRIGGER guard_grn_pending_transporter BEFORE INSERT OR UPDATE OF status ON public.goods_received_notes
FOR EACH ROW EXECUTE FUNCTION public.guard_grn_pending_transporter();

NOTIFY pgrst, 'reload schema';
COMMIT;
