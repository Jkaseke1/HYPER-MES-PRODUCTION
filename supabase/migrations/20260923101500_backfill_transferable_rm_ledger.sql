-- Bring legacy RM ledger rows into line immediately after the fresh-Sage
-- transfer safeguard is installed. The value represents transferable stock:
-- current Sage RM on hand less material already allocated to Buffer.

DO $$
DECLARE
  v_raw_material_id uuid;
BEGIN
  FOR v_raw_material_id IN
    SELECT DISTINCT raw_material_id
    FROM public.sage_stock_balances
    WHERE warehouse_id = 18
      AND raw_material_id IS NOT NULL
  LOOP
    PERFORM public.reconcile_transferable_rm_balance(v_raw_material_id);
  END LOOP;
END;
$$;
