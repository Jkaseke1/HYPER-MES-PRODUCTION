/*
  # Formulation / Bill of Materials Tables

  1. New Tables
    - `formulations` - Feed formulas (BOM) with versioning and nutritional targets
    - `formulation_ingredients` - Ingredients for each formula with quantities and percentages

  2. Notes
    - Formulations support versioning for formula changes
    - Cost is auto-calculated from ingredient costs
    - Each ingredient tracks percentage of total and quantity per batch
*/

CREATE TABLE IF NOT EXISTS formulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE NOT NULL,
  version integer DEFAULT 1,
  category text DEFAULT '' CHECK (category IN ('broiler', 'layer', 'dairy', 'pig', 'horse', 'pet', 'other', '')),
  description text DEFAULT '',
  batch_size numeric NOT NULL DEFAULT 1000,
  batch_unit text DEFAULT 'kg',
  target_protein numeric DEFAULT 0,
  target_fat numeric DEFAULT 0,
  target_fiber numeric DEFAULT 0,
  target_moisture numeric DEFAULT 0,
  estimated_cost_per_unit numeric DEFAULT 0,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_by uuid REFERENCES profiles(id),
  approved_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE formulations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read formulations"
  ON formulations FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert formulations"
  ON formulations FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update formulations"
  ON formulations FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can delete formulations"
  ON formulations FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS formulation_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formulation_id uuid REFERENCES formulations(id) ON DELETE CASCADE,
  raw_material_id uuid REFERENCES raw_materials(id),
  quantity numeric NOT NULL DEFAULT 0,
  unit text DEFAULT 'kg',
  percentage numeric DEFAULT 0,
  is_critical boolean DEFAULT false,
  notes text DEFAULT '',
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE formulation_ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read formulation_ingredients"
  ON formulation_ingredients FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert formulation_ingredients"
  ON formulation_ingredients FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update formulation_ingredients"
  ON formulation_ingredients FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can delete formulation_ingredients"
  ON formulation_ingredients FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);