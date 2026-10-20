-- Lets Logistics link a customer dispatch order to the CRM customer and the
-- won CRM deal it fulfils. Additive only: existing dispatches, approvals and
-- Sage posting are unchanged, and both links are optional.

ALTER TABLE public.dispatch_orders
  ADD COLUMN IF NOT EXISTS crm_customer_id uuid REFERENCES public.crm_customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS crm_opportunity_id uuid REFERENCES public.crm_opportunities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dispatch_orders_crm_customer ON public.dispatch_orders(crm_customer_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_orders_crm_opportunity ON public.dispatch_orders(crm_opportunity_id);

NOTIFY pgrst, 'reload schema';
