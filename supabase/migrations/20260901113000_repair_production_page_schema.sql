-- Production page schema repair.
-- This migration contains configuration and empty-table schema only. It does
-- not import UAT data, create operational transactions, or contact Sage.

-- Formulation product-family lookup used by the Formulations page.
CREATE TABLE IF NOT EXISTS public.formulation_categories (
  code text PRIMARY KEY,
  name text NOT NULL,
  sage_category_code text,
  display_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_formulation_categories_active
  ON public.formulation_categories (is_active, display_order);

-- Static application configuration, not operational or Sage master data.
INSERT INTO public.formulation_categories (code, name, sage_category_code, display_order) VALUES
  ('broiler', 'Broiler', 'POUL', 10),
  ('layer', 'Layer', 'POUL', 20),
  ('breeder', 'Breeder', 'POUL', 30),
  ('game_bird', 'Game Bird', 'POUL', 40),
  ('dairy', 'Dairy Cattle', 'RUM', 50),
  ('beef', 'Beef Cattle', 'RUM', 60),
  ('pig', 'Pig', NULL, 70),
  ('horse', 'Horse', NULL, 80),
  ('rabbit', 'Rabbit', NULL, 90),
  ('dog_food', 'Dog Food', NULL, 100),
  ('cat_food', 'Cat Food', NULL, 110),
  ('fish', 'Fish', NULL, 120),
  ('chemicals', 'Chemicals', 'CHEM', 200),
  ('equipment', 'Equipment', 'EQUI', 210),
  ('pet', 'Pet (Legacy)', NULL, 900),
  ('other', 'Other', NULL, 1000)
ON CONFLICT (code) DO UPDATE
  SET name = excluded.name,
      sage_category_code = excluded.sage_category_code,
      display_order = excluded.display_order,
      updated_at = now();

ALTER TABLE public.formulations DROP CONSTRAINT IF EXISTS formulations_category_check;
ALTER TABLE public.formulation_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read formulation_categories" ON public.formulation_categories;
CREATE POLICY "Authenticated can read formulation_categories"
  ON public.formulation_categories FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can manage formulation_categories" ON public.formulation_categories;
CREATE POLICY "Authenticated can manage formulation_categories"
  ON public.formulation_categories FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Production Orders page selects creator:profiles!created_by.
ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS created_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.production_orders'::regclass
      AND c.confrelid = 'public.profiles'::regclass
      AND c.contype = 'f'
      AND a.attname = 'created_by'
  ) THEN
    ALTER TABLE public.production_orders
      ADD CONSTRAINT production_orders_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES public.profiles(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_production_orders_created_by
  ON public.production_orders (created_by);
CREATE INDEX IF NOT EXISTS idx_production_orders_operator_id
  ON public.production_orders (operator_id);

-- Digital production declarations and verification workflow.
CREATE TABLE IF NOT EXISTS public.production_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id uuid NOT NULL UNIQUE REFERENCES public.production_orders(id) ON DELETE CASCADE,
  output_qty_kg numeric NOT NULL DEFAULT 0 CHECK (output_qty_kg >= 0),
  output_bags numeric NOT NULL DEFAULT 0 CHECK (output_bags >= 0),
  rejected_qty_kg numeric NOT NULL DEFAULT 0 CHECK (rejected_qty_kg >= 0),
  recycle_qty_kg numeric NOT NULL DEFAULT 0 CHECK (recycle_qty_kg >= 0),
  variance_reason text NOT NULL DEFAULT '',
  declaration_notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'verified', 'returned')),
  submitted_by uuid REFERENCES public.profiles(id),
  submitted_at timestamptz,
  verified_by uuid REFERENCES public.profiles(id),
  verified_at timestamptz,
  verification_notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_production_notices_status ON public.production_notices(status);
CREATE INDEX IF NOT EXISTS idx_production_notices_order ON public.production_notices(production_order_id);

ALTER TABLE public.production_notices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read production notices" ON public.production_notices;
CREATE POLICY "Authenticated users can read production notices"
  ON public.production_notices FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can create production notices" ON public.production_notices;
CREATE POLICY "Authenticated users can create production notices"
  ON public.production_notices FOR INSERT TO authenticated
  WITH CHECK (submitted_by = auth.uid() OR submitted_by IS NULL);

DROP POLICY IF EXISTS "Authenticated users can update production notices" ON public.production_notices;
CREATE POLICY "Authenticated users can update production notices"
  ON public.production_notices FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
