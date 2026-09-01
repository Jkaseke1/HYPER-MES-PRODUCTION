-- Add finance/Sage matching references to GRNs.
-- These fields are optional, but they let Finance search Sage by the same
-- invoice, delivery note, PO/order and weighbridge references used on paper.

ALTER TABLE public.goods_received_notes
  ADD COLUMN IF NOT EXISTS supplier_invoice_no text,
  ADD COLUMN IF NOT EXISTS supplier_delivery_note_no text,
  ADD COLUMN IF NOT EXISTS supplier_order_no text,
  ADD COLUMN IF NOT EXISTS external_reference text;

COMMENT ON COLUMN public.goods_received_notes.supplier_invoice_no IS
  'Supplier invoice number to map to Sage ExtOrderNum / finance matching.';
COMMENT ON COLUMN public.goods_received_notes.supplier_delivery_note_no IS
  'Supplier delivery note number to map to Sage DeliveryNote / Reference2.';
COMMENT ON COLUMN public.goods_received_notes.supplier_order_no IS
  'Supplier order or PO number to map to Sage OrderNum.';
COMMENT ON COLUMN public.goods_received_notes.external_reference IS
  'External reference such as weighbridge ticket or supplier load reference.';

CREATE INDEX IF NOT EXISTS idx_grn_supplier_invoice_no
  ON public.goods_received_notes (supplier_invoice_no);

CREATE INDEX IF NOT EXISTS idx_grn_supplier_delivery_note_no
  ON public.goods_received_notes (supplier_delivery_note_no);

CREATE INDEX IF NOT EXISTS idx_grn_supplier_order_no
  ON public.goods_received_notes (supplier_order_no);
