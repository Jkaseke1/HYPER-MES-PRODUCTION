-- LIVE: nxlhgpqtmgixhazihapz. Operational list only; no claims, stock or Sage writes.
BEGIN;
CREATE OR REPLACE FUNCTION public.list_inbound_transporters_for_weighbridge()
RETURNS TABLE(id uuid, transporter_code text, name text, default_currency text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.has_mes_role(ARRAY[
    'admin', 'raw_material_manager', 'rm_manager', 'weighbridge', 'weigh_bridge'
  ]), false) THEN
    RAISE EXCEPTION 'Only Weighbridge, Raw Materials Manager or Admin may view the transporter list.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT t.id,
    CASE WHEN to_jsonb(t)->>'sage_registration_status' = 'verified'
      THEN coalesce(nullif(to_jsonb(t)->>'sage_supplier_account', ''), t.transporter_code)
      ELSE t.transporter_code END,
    t.name, t.default_currency
  FROM public.inbound_transporters t WHERE t.is_active ORDER BY t.name, t.id;
END; $$;
REVOKE ALL ON FUNCTION public.list_inbound_transporters_for_weighbridge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_inbound_transporters_for_weighbridge() TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
