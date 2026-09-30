-- Approved rate cards are local PlantControl controls. They support the
-- transporter account register and do not create Sage transactions.

CREATE TABLE IF NOT EXISTS public.inbound_transporter_rate_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transporter_id uuid NOT NULL REFERENCES public.inbound_transporters(id) ON DELETE RESTRICT,
  route_from text NOT NULL,
  route_to text NOT NULL,
  vehicle_type text,
  material_group text,
  currency_code text NOT NULL DEFAULT 'USD',
  rate_per_tonne numeric(14,4) NOT NULL CHECK (rate_per_tonne > 0),
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(route_from)) > 0),
  CHECK (length(btrim(route_to)) > 0),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_inbound_transporter_rate_cards_account
  ON public.inbound_transporter_rate_cards(transporter_id, effective_from DESC);

ALTER TABLE public.inbound_transporter_rate_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY inbound_transporter_rate_cards_admin_only ON public.inbound_transporter_rate_cards
  FOR ALL TO authenticated
  USING (public.has_mes_role(ARRAY['admin']))
  WITH CHECK (public.has_mes_role(ARRAY['admin']));

NOTIFY pgrst, 'reload schema';
