-- Correct missing/wrong transporter evidence before any freight claim is saved.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.guard_linked_ticket_transporter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_role text;
BEGIN
  IF NEW.inbound_transporter_id IS NOT DISTINCT FROM OLD.inbound_transporter_id
     AND NEW.inbound_transport_mode IS NOT DISTINCT FROM OLD.inbound_transport_mode THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.goods_received_notes WHERE weigh_bridge_ticket_id = OLD.id) THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF coalesce(v_role, '') NOT IN ('admin', 'raw_material_manager', 'rm_manager')
      OR NEW.inbound_transport_mode IS DISTINCT FROM OLD.inbound_transport_mode
      OR OLD.inbound_transport_mode IS DISTINCT FROM 'company_hired'
      OR EXISTS (SELECT 1 FROM public.goods_received_notes WHERE weigh_bridge_ticket_id = OLD.id
        AND coalesce(status, '') NOT IN ('pending', 'pending_costing', 'pending_finance'))
      OR EXISTS (SELECT 1 FROM public.inbound_transport_claims WHERE weigh_bridge_ticket_id = OLD.id) THEN
      RAISE EXCEPTION 'Transporter changes require a pending company-hired GRN without a saved freight claim.';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.complete_pending_grn_transporter(p_grn_id uuid, p_transporter_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_grn public.goods_received_notes%ROWTYPE; v_ticket public.weigh_bridge_tickets%ROWTYPE;
  v_transporter public.inbound_transporters%ROWTYPE; v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF coalesce(v_role, '') NOT IN ('admin', 'raw_material_manager', 'rm_manager') THEN
    RAISE EXCEPTION 'Only Raw Materials or Admin may complete the transporter.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_grn FROM public.goods_received_notes WHERE id = p_grn_id FOR UPDATE;
  IF NOT FOUND OR coalesce(v_grn.status, '') NOT IN ('pending', 'pending_costing', 'pending_finance') THEN
    RAISE EXCEPTION 'Transporter evidence is locked after GRN approval.';
  END IF;
  SELECT * INTO v_ticket FROM public.weigh_bridge_tickets WHERE id = v_grn.weigh_bridge_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_ticket.inbound_transport_mode IS DISTINCT FROM 'company_hired' THEN
    RAISE EXCEPTION 'Weighbridge must select company-hired transport first.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.inbound_transport_claims WHERE weigh_bridge_ticket_id = v_ticket.id) THEN
    RAISE EXCEPTION 'A freight claim already uses this transporter. Ask Admin to review the evidence before changing it.';
  END IF;
  SELECT * INTO v_transporter FROM public.inbound_transporters WHERE id = p_transporter_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active transporter.'; END IF;
  UPDATE public.weigh_bridge_tickets SET inbound_transporter_id = p_transporter_id,
    haulier_code = v_transporter.transporter_code WHERE id = v_ticket.id;
  UPDATE public.inbound_transporters SET registration_audit = registration_audit ||
    jsonb_build_array(jsonb_build_object('action', 'pending_grn_transporter_completed',
      'grn_id', p_grn_id, 'ticket_id', v_ticket.id, 'previous_transporter_id', v_ticket.inbound_transporter_id,
      'by', auth.uid(), 'at', now())) WHERE id = p_transporter_id;
END; $$;
REVOKE ALL ON FUNCTION public.complete_pending_grn_transporter(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_pending_grn_transporter(uuid, uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.update_pending_grn_transporter_details(
  p_grn_id uuid, p_name text, p_phone text, p_note text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_grn public.goods_received_notes%ROWTYPE; v_ticket public.weigh_bridge_tickets%ROWTYPE;
  v_transporter public.inbound_transporters%ROWTYPE; v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF coalesce(v_role, '') NOT IN ('admin', 'raw_material_manager', 'rm_manager') THEN
    RAISE EXCEPTION 'Only Raw Materials or Admin may edit pending transporter details.' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 3 AND 160
    OR length(coalesce(p_phone,'')) > 50 OR length(coalesce(p_note,'')) > 500 THEN
    RAISE EXCEPTION 'Enter a name of 3-160 characters, phone up to 50 and note up to 500 characters.';
  END IF;
  SELECT * INTO v_grn FROM public.goods_received_notes WHERE id = p_grn_id FOR UPDATE;
  IF NOT FOUND OR coalesce(v_grn.status,'') NOT IN ('pending','pending_costing','pending_finance') THEN
    RAISE EXCEPTION 'Transporter evidence is locked after GRN approval.';
  END IF;
  SELECT * INTO v_ticket FROM public.weigh_bridge_tickets WHERE id = v_grn.weigh_bridge_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_ticket.inbound_transport_mode IS DISTINCT FROM 'company_hired' THEN
    RAISE EXCEPTION 'A company-hired ticket is required.';
  END IF;
  SELECT * INTO v_transporter FROM public.inbound_transporters WHERE id = v_ticket.inbound_transporter_id FOR UPDATE;
  IF NOT FOUND OR NOT v_transporter.is_active OR v_transporter.sage_registration_status <> 'pending' THEN
    RAISE EXCEPTION 'Only a new transporter awaiting Finance registration can be edited here.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.inbound_transport_claims WHERE transporter_id = v_transporter.id)
    OR EXISTS (SELECT 1 FROM public.weigh_bridge_tickets WHERE inbound_transporter_id = v_transporter.id AND id <> v_ticket.id) THEN
    RAISE EXCEPTION 'This transporter is shared or has freight evidence. Select a separate new transporter instead of renaming it.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('pending_transporter'), hashtext(lower(btrim(p_name))));
  IF EXISTS (SELECT 1 FROM public.inbound_transporters WHERE id <> v_transporter.id
    AND is_active AND lower(btrim(name)) = lower(btrim(p_name))) THEN
    RAISE EXCEPTION 'That transporter already exists. Select it from the transporter list.';
  END IF;
  UPDATE public.inbound_transporters SET name = btrim(p_name), contact_phone = nullif(btrim(p_phone),''),
    registration_note = nullif(btrim(p_note),''), updated_at = now(),
    registration_audit = registration_audit || jsonb_build_array(jsonb_build_object(
      'action','pending_details_updated','grn_id',p_grn_id,'by',auth.uid(),'at',now(),
      'before',jsonb_build_object('name',name,'phone',contact_phone,'note',registration_note),
      'after',jsonb_build_object('name',btrim(p_name),'phone',nullif(btrim(p_phone),''),'note',nullif(btrim(p_note),''))
    )) WHERE id = v_transporter.id;
END; $$;
REVOKE ALL ON FUNCTION public.update_pending_grn_transporter_details(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_pending_grn_transporter_details(uuid,text,text,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
