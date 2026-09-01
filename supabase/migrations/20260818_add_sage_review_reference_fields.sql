-- Carry Sage document reference fields through the Finance review queue.
-- These are nullable so existing review rows continue to work.

ALTER TABLE public.sage_posting_reviews
  ADD COLUMN IF NOT EXISTS sage_order_num text,
  ADD COLUMN IF NOT EXISTS sage_ext_order_num text,
  ADD COLUMN IF NOT EXISTS sage_delivery_note text;

COMMENT ON COLUMN public.sage_posting_reviews.sage_order_num IS
  'Value passed to Sage OrderNum for GRV/AP document matching.';
COMMENT ON COLUMN public.sage_posting_reviews.sage_ext_order_num IS
  'Value passed to Sage ExtOrderNum, usually supplier invoice or external reference.';
COMMENT ON COLUMN public.sage_posting_reviews.sage_delivery_note IS
  'Supplier delivery note captured from MES GRN.';
