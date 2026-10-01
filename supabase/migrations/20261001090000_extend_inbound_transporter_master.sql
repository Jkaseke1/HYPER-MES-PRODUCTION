-- ERP-style carrier master details for PlantControl's local transporter accounts.
-- This is deliberately separate from Sage supplier and accounts-payable records.

ALTER TABLE public.inbound_transporters
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS account_reference text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS tax_registration_no text,
  ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS business_address text,
  ADD COLUMN IF NOT EXISTS vehicle_capabilities text,
  ADD COLUMN IF NOT EXISTS compliance_expiry date,
  ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';

UPDATE public.inbound_transporters
SET legal_name = name
WHERE legal_name IS NULL OR btrim(legal_name) = '';

ALTER TABLE public.inbound_transporters
  DROP CONSTRAINT IF EXISTS inbound_transporters_payment_terms_check;

ALTER TABLE public.inbound_transporters
  ADD CONSTRAINT inbound_transporters_payment_terms_check
  CHECK (payment_terms_days >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inbound_transporters_account_reference
  ON public.inbound_transporters(account_reference)
  WHERE account_reference IS NOT NULL AND btrim(account_reference) <> '';

NOTIFY pgrst, 'reload schema';
