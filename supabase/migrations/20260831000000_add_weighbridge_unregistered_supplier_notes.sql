-- PlantControl-only intake details for a supplier not yet created by Finance.
ALTER TABLE public.weigh_bridge_tickets
  ADD COLUMN IF NOT EXISTS unregistered_supplier_name text,
  ADD COLUMN IF NOT EXISTS finance_note text;

ALTER TABLE public.weigh_bridge_tickets
  ADD CONSTRAINT weigh_bridge_supplier_or_unregistered_name_check
  CHECK (
    supplier_id IS NOT NULL
    OR NULLIF(btrim(unregistered_supplier_name), '') IS NOT NULL
  ) NOT VALID;

COMMENT ON COLUMN public.weigh_bridge_tickets.unregistered_supplier_name
  IS 'Supplier name captured at the weighbridge when no supplier master record exists.';
COMMENT ON COLUMN public.weigh_bridge_tickets.finance_note
  IS 'Finance follow-up required before the ticket can be linked to a GRN.';
