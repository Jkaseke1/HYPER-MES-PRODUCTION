-- Shared Production operations schema.
-- No UAT transactions, historical rates, price records, or Sage activity are imported.

CREATE TABLE IF NOT EXISTS public.currencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL CHECK (code IN ('ZAR', 'USD', 'ZWG', 'GBP')),
  name text NOT NULL,
  symbol text NOT NULL,
  is_base_currency boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Standard currency definitions are application configuration, not transaction data.
INSERT INTO public.currencies (code, name, symbol, is_base_currency, is_active) VALUES
  ('USD', 'US Dollar', '$', true, true),
  ('ZAR', 'South African Rand', 'R', false, true),
  ('ZWG', 'Zimbabwe Gold', 'ZWG', false, true),
  ('GBP', 'British Pound', 'GBP', false, true)
ON CONFLICT (code) DO UPDATE
  SET name = excluded.name,
      symbol = excluded.symbol,
      is_base_currency = excluded.is_base_currency,
      is_active = excluded.is_active,
      updated_at = now();

CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency text NOT NULL REFERENCES public.currencies(code),
  to_currency text NOT NULL REFERENCES public.currencies(code),
  rate numeric(18,6) NOT NULL CHECK (rate > 0),
  effective_date date NOT NULL DEFAULT current_date,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_currency, to_currency, effective_date)
);

CREATE TABLE IF NOT EXISTS public.labour_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formulation_id uuid NOT NULL REFERENCES public.formulations(id) ON DELETE CASCADE,
  rate_per_tonne_usd numeric(10,4) NOT NULL,
  effective_date date NOT NULL DEFAULT current_date,
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (formulation_id, effective_date)
);

CREATE TABLE IF NOT EXISTS public.cost_settings (
  key text PRIMARY KEY,
  value numeric NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.variance_reason_codes (
  code text PRIMARY KEY,
  description text NOT NULL,
  category text
);

CREATE TABLE IF NOT EXISTS public.stock_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type text NOT NULL,
  material_name text NOT NULL,
  available_qty numeric(14,4),
  requested_qty numeric(14,4),
  shortfall_qty numeric(14,4),
  override_reason text,
  overridden_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.approval_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  previous_status text,
  new_status text NOT NULL,
  approved_by uuid REFERENCES public.profiles(id),
  comments text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.approval_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text,
  reference_number text,
  action_type text,
  user_email text,
  user_name text,
  user_role text,
  action_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labour_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.variance_reason_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_audit_log ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'currencies', 'exchange_rates', 'labour_rates', 'cost_settings',
    'variance_reason_codes', 'stock_exceptions', 'approval_history', 'approval_audit_log'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can manage %1$s" ON public.%1$I', table_name);
    EXECUTE format('CREATE POLICY "Authenticated users can manage %1$s" ON public.%1$I FOR ALL TO authenticated USING (true) WITH CHECK (true)', table_name);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_exchange_rates_currencies_date
  ON public.exchange_rates(from_currency, to_currency, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_labour_rates_formulation
  ON public.labour_rates(formulation_id);
CREATE INDEX IF NOT EXISTS idx_stock_exceptions_created_at
  ON public.stock_exceptions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_history_entity
  ON public.approval_history(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_approval_audit_log_created_at
  ON public.approval_audit_log(created_at DESC);

CREATE OR REPLACE FUNCTION public.log_approval_action(
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_previous_status text,
  p_new_status text,
  p_approved_by uuid,
  p_comments text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  history_id uuid;
BEGIN
  INSERT INTO public.approval_history (
    entity_type, entity_id, action, previous_status, new_status, approved_by, comments
  ) VALUES (
    p_entity_type, p_entity_id, p_action, p_previous_status, p_new_status, p_approved_by, p_comments
  )
  RETURNING id INTO history_id;

  RETURN history_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_approval_action(text, uuid, text, text, text, uuid, text)
  TO authenticated, service_role;
