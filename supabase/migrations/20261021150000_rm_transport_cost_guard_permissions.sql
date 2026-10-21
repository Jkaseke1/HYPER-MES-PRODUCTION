-- LIVE: nxlhgpqtmgixhazihapz. Repairs legacy Admin-only guards; no receipt/stock/Sage writes.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.guard_inbound_transport_claim_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.has_mes_role(ARRAY[
    'admin', 'raw_material_manager', 'rm_manager'
  ]), false) THEN
    RAISE EXCEPTION 'Only Raw Materials Manager or Admin may record or update inbound transport costs.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF NOT public.has_mes_role(ARRAY['admin']) THEN
      RAISE EXCEPTION 'Only Admin may delete transport claims.' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_guard_inbound_transport_claim_admin ON public.inbound_transport_claims;
CREATE TRIGGER trg_guard_inbound_transport_claim_admin
  BEFORE INSERT OR UPDATE OR DELETE ON public.inbound_transport_claims
  FOR EACH ROW EXECUTE FUNCTION public.guard_inbound_transport_claim_admin();

DROP POLICY IF EXISTS inbound_transporters_read ON public.inbound_transporters;
CREATE POLICY inbound_transporters_read ON public.inbound_transporters FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));
DROP POLICY IF EXISTS inbound_transport_claims_read ON public.inbound_transport_claims;
CREATE POLICY inbound_transport_claims_read ON public.inbound_transport_claims FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));
DROP POLICY IF EXISTS inbound_transport_claim_history_read ON public.inbound_transport_claim_history;
CREATE POLICY inbound_transport_claim_history_read ON public.inbound_transport_claim_history FOR SELECT TO authenticated
  USING (public.has_mes_role(ARRAY['admin', 'raw_material_manager', 'rm_manager']));

-- Keep the existing flat-cost validation, approval/queue locks and audit triggers.
GRANT EXECUTE ON FUNCTION public.save_inbound_transport_flat_claim(uuid, uuid, uuid, numeric, text, text, text, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
