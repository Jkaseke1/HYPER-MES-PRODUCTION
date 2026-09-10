-- Allow GRN capture for suppliers not yet present in the supplier master.
ALTER TABLE public.goods_received_notes
  ADD COLUMN IF NOT EXISTS unregistered_supplier_name text;

COMMENT ON COLUMN public.goods_received_notes.unregistered_supplier_name
  IS 'Supplier name captured when the supplier is not yet in the supplier master; must be resolved before Sage posting.';
