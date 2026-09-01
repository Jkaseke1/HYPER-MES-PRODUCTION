-- Phase 6: Macropack Manufacturing tables

CREATE TABLE IF NOT EXISTS macropack_boms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  macropack_code TEXT NOT NULL,
  macropack_name TEXT NOT NULL,
  version INT DEFAULT 1,
  effective_from DATE,
  effective_to DATE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS macropack_bom_ingredients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  macropack_bom_id UUID REFERENCES macropack_boms(id),
  raw_material_id UUID REFERENCES raw_materials(id),
  grams_per_unit NUMERIC(10,4) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS macropack_manufacture_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  macropack_bom_id UUID REFERENCES macropack_boms(id),
  planned_units INT,
  actual_units INT,
  manufacture_date DATE,
  manufactured_by UUID,
  status TEXT DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS macropack_manufacture_issues (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  manufacture_order_id UUID REFERENCES macropack_manufacture_orders(id),
  raw_material_id UUID REFERENCES raw_materials(id),
  expected_grams NUMERIC(10,4),
  actual_grams_dispensed NUMERIC(10,4),
  variance_grams NUMERIC(10,4) GENERATED ALWAYS AS (actual_grams_dispensed - expected_grams) STORED,
  dispensed_at TIMESTAMPTZ,
  scale_ticket_ref TEXT
);

-- Enable RLS
ALTER TABLE macropack_boms ENABLE ROW LEVEL SECURITY;
ALTER TABLE macropack_bom_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE macropack_manufacture_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE macropack_manufacture_issues ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Auth read macropack_boms" ON macropack_boms FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Auth insert macropack_boms" ON macropack_boms FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Auth update macropack_boms" ON macropack_boms FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Auth read macropack_bom_ingredients" ON macropack_bom_ingredients FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Auth insert macropack_bom_ingredients" ON macropack_bom_ingredients FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Auth read macropack_manufacture_orders" ON macropack_manufacture_orders FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Auth insert macropack_manufacture_orders" ON macropack_manufacture_orders FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Auth update macropack_manufacture_orders" ON macropack_manufacture_orders FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Auth read macropack_manufacture_issues" ON macropack_manufacture_issues FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Auth insert macropack_manufacture_issues" ON macropack_manufacture_issues FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Auth update macropack_manufacture_issues" ON macropack_manufacture_issues FOR UPDATE USING (auth.role() = 'authenticated');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_macropack_bom_ingredients_bom ON macropack_bom_ingredients(macropack_bom_id);
CREATE INDEX IF NOT EXISTS idx_macropack_manufacture_orders_bom ON macropack_manufacture_orders(macropack_bom_id);
CREATE INDEX IF NOT EXISTS idx_macropack_manufacture_orders_status ON macropack_manufacture_orders(status);
CREATE INDEX IF NOT EXISTS idx_macropack_manufacture_issues_order ON macropack_manufacture_issues(manufacture_order_id);
