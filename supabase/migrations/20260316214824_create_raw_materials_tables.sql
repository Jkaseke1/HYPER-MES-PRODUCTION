/*
  # Raw Material Management Tables

  1. New Tables
    - `raw_materials` - Raw material master with categories, units, and reorder levels
    - `goods_received_notes` - GRN tracking for incoming raw materials
    - `grn_items` - Line items for each GRN
    - `quality_inspections` - Quality checks on received materials

  2. Security
    - RLS enabled on all tables
    - Authenticated users can read and write
*/

CREATE TABLE IF NOT EXISTS raw_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE NOT NULL,
  category text DEFAULT '' CHECK (category IN ('grain', 'protein', 'mineral', 'vitamin', 'additive', 'other', '')),
  unit text NOT NULL DEFAULT 'kg',
  cost_per_unit numeric DEFAULT 0,
  reorder_level numeric DEFAULT 0,
  current_stock numeric DEFAULT 0,
  warehouse_id uuid REFERENCES warehouses(id),
  description text DEFAULT '',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE raw_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read raw_materials"
  ON raw_materials FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert raw_materials"
  ON raw_materials FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update raw_materials"
  ON raw_materials FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can delete raw_materials"
  ON raw_materials FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS goods_received_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_number text UNIQUE NOT NULL,
  supplier_id uuid REFERENCES suppliers(id),
  warehouse_id uuid REFERENCES warehouses(id),
  received_date date DEFAULT CURRENT_DATE,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'inspecting', 'approved', 'rejected')),
  notes text DEFAULT '',
  received_by uuid REFERENCES profiles(id),
  total_value numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE goods_received_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read grn"
  ON goods_received_notes FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert grn"
  ON goods_received_notes FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update grn"
  ON goods_received_notes FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS grn_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid REFERENCES goods_received_notes(id) ON DELETE CASCADE,
  raw_material_id uuid REFERENCES raw_materials(id),
  ordered_qty numeric DEFAULT 0,
  received_qty numeric DEFAULT 0,
  unit_cost numeric DEFAULT 0,
  batch_number text DEFAULT '',
  expiry_date date,
  line_total numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE grn_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read grn_items"
  ON grn_items FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert grn_items"
  ON grn_items FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update grn_items"
  ON grn_items FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can delete grn_items"
  ON grn_items FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS quality_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid REFERENCES goods_received_notes(id),
  raw_material_id uuid REFERENCES raw_materials(id),
  batch_number text DEFAULT '',
  inspection_date date DEFAULT CURRENT_DATE,
  inspector_id uuid REFERENCES profiles(id),
  result text DEFAULT 'pending' CHECK (result IN ('pending', 'passed', 'failed', 'conditional')),
  moisture_content numeric,
  protein_content numeric,
  fat_content numeric,
  fiber_content numeric,
  remarks text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE quality_inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read quality_inspections"
  ON quality_inspections FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert quality_inspections"
  ON quality_inspections FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update quality_inspections"
  ON quality_inspections FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);