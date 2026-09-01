-- Chick Management Full Workflow Migration
-- Creates tables for PO → Hatch Night → Delivery → Invoice → Sage Worksheet

-- 1. Suppliers master
CREATE TABLE IF NOT EXISTS chick_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Purchase Orders (extend if exists, otherwise create)
CREATE TABLE IF NOT EXISTS chick_purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number TEXT UNIQUE NOT NULL,
  supplier_id UUID REFERENCES chick_suppliers(id),
  expected_delivery_date DATE NOT NULL,
  chick_type TEXT CHECK (chick_type IN ('STANDARD','HUBBARD')) DEFAULT 'STANDARD',
  status TEXT CHECK (status IN (
    'DRAFT','SUBMITTED','APPROVED','DISPATCHED','DELIVERED','INVOICED'
  )) DEFAULT 'DRAFT',
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns if table already exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='chick_purchase_orders' AND column_name='supplier_id') THEN
    ALTER TABLE chick_purchase_orders ADD COLUMN supplier_id UUID REFERENCES chick_suppliers(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='chick_purchase_orders' AND column_name='expected_delivery_date') THEN
    ALTER TABLE chick_purchase_orders ADD COLUMN expected_delivery_date DATE NOT NULL DEFAULT CURRENT_DATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='chick_purchase_orders' AND column_name='chick_type') THEN
    ALTER TABLE chick_purchase_orders ADD COLUMN chick_type TEXT CHECK (chick_type IN ('STANDARD','HUBBARD')) DEFAULT 'STANDARD';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='chick_purchase_orders' AND column_name='approved_by') THEN
    ALTER TABLE chick_purchase_orders ADD COLUMN approved_by UUID REFERENCES profiles(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='chick_purchase_orders' AND column_name='approved_at') THEN
    ALTER TABLE chick_purchase_orders ADD COLUMN approved_at TIMESTAMPTZ;
  END IF;
END $$;

-- 3. PO Branch Demand Lines
CREATE TABLE IF NOT EXISTS chick_po_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID REFERENCES chick_purchase_orders(id) ON DELETE CASCADE,
  branch_code TEXT NOT NULL,
  delivery_type TEXT CHECK (delivery_type IN ('LOCAL','BRANCH')),
  booked_qty INTEGER NOT NULL DEFAULT 0,
  wish_qty INTEGER DEFAULT 0,
  chick_type TEXT CHECK (chick_type IN ('STANDARD','HUBBARD')) DEFAULT 'STANDARD',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Hatch Nights
CREATE TABLE IF NOT EXISTS chick_hatch_nights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hatch_date DATE NOT NULL,
  status TEXT CHECK (status IN ('DRAFT','CONFIRMED','COMPLETE')) DEFAULT 'DRAFT',
  hatch_completion_status TEXT CHECK (
    hatch_completion_status IN ('COMPLETE','IN_PROGRESS')
  ) DEFAULT 'IN_PROGRESS',
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Supplier Consignments per Hatch Night
CREATE TABLE IF NOT EXISTS chick_supplier_consignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hatch_night_id UUID REFERENCES chick_hatch_nights(id) ON DELETE CASCADE,
  po_id UUID REFERENCES chick_purchase_orders(id),
  supplier_id UUID REFERENCES chick_suppliers(id),
  hatch_completion_status TEXT CHECK (
    hatch_completion_status IN ('COMPLETE','IN_PROGRESS')
  ) DEFAULT 'IN_PROGRESS',
  notes TEXT,
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Delivery Notes (DNOTE level)
CREATE TABLE IF NOT EXISTS chick_delivery_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_id UUID REFERENCES chick_supplier_consignments(id) ON DELETE CASCADE,
  po_line_id UUID REFERENCES chick_po_lines(id),
  dnote_number TEXT NOT NULL,
  branch_code TEXT NOT NULL,
  delivery_type TEXT CHECK (delivery_type IN ('LOCAL','BRANCH')),
  chick_type TEXT CHECK (chick_type IN ('STANDARD','HUBBARD')) DEFAULT 'STANDARD',
  quantity_allocated INTEGER NOT NULL DEFAULT 0,
  quantity_received INTEGER,
  variance INTEGER GENERATED ALWAYS AS 
    (quantity_received - quantity_allocated) STORED,
  status TEXT CHECK (status IN (
    'PENDING','DELIVERED','VARIANCE','CANCELLED'
  )) DEFAULT 'PENDING',
  driver_name TEXT,
  vehicle_reg TEXT,
  declared_by UUID REFERENCES profiles(id),
  declared_at TIMESTAMPTZ,
  condition_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Supplier Invoices
CREATE TABLE IF NOT EXISTS chick_supplier_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_id UUID REFERENCES chick_supplier_consignments(id),
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  invoice_amount NUMERIC(12,2) NOT NULL,
  quantity_invoiced INTEGER NOT NULL,
  unit_cost NUMERIC(10,4) GENERATED ALWAYS AS 
    (invoice_amount / NULLIF(quantity_invoiced, 0)) STORED,
  status TEXT CHECK (status IN (
    'PENDING','VERIFIED','POSTED'
  )) DEFAULT 'PENDING',
  verified_by UUID REFERENCES profiles(id),
  verified_at TIMESTAMPTZ,
  posted_by UUID REFERENCES profiles(id),
  posted_at TIMESTAMPTZ,
  sage_posting_ref TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Indexes
CREATE INDEX IF NOT EXISTS idx_chick_delivery_notes_branch ON chick_delivery_notes(branch_code);
CREATE INDEX IF NOT EXISTS idx_chick_delivery_notes_dnote ON chick_delivery_notes(dnote_number);
CREATE INDEX IF NOT EXISTS idx_chick_hatch_nights_date ON chick_hatch_nights(hatch_date);
CREATE INDEX IF NOT EXISTS idx_chick_purchase_orders_status ON chick_purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_chick_supplier_invoices_status ON chick_supplier_invoices(status);
CREATE INDEX IF NOT EXISTS idx_chick_delivery_notes_status ON chick_delivery_notes(status);

-- 9. View for Owen's Excel summary
CREATE OR REPLACE VIEW vw_chick_night_summary AS
SELECT
  hn.hatch_date,
  s.name AS supplier,
  dn.dnote_number,
  dn.branch_code,
  dn.chick_type,
  dn.delivery_type,
  dn.quantity_allocated,
  dn.quantity_received,
  dn.variance,
  dn.status AS dnote_status,
  inv.invoice_number,
  inv.invoice_date,
  inv.invoice_amount,
  inv.quantity_invoiced,
  inv.unit_cost,
  inv.status AS invoice_status,
  inv.sage_posting_ref,
  po.po_number
FROM chick_delivery_notes dn
JOIN chick_supplier_consignments sc ON sc.id = dn.consignment_id
JOIN chick_hatch_nights hn ON hn.id = sc.hatch_night_id
JOIN chick_suppliers s ON s.id = sc.supplier_id
LEFT JOIN chick_supplier_invoices inv ON inv.consignment_id = sc.id
LEFT JOIN chick_purchase_orders po ON po.id = sc.po_id
ORDER BY hn.hatch_date DESC, s.name, dn.dnote_number;

-- 10. RLS Policies
ALTER TABLE chick_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE chick_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE chick_po_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE chick_hatch_nights ENABLE ROW LEVEL SECURITY;
ALTER TABLE chick_supplier_consignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE chick_delivery_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE chick_supplier_invoices ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Allow authenticated read chick_suppliers" ON chick_suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read chick_purchase_orders" ON chick_purchase_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read chick_po_lines" ON chick_po_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read chick_hatch_nights" ON chick_hatch_nights FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read chick_supplier_consignments" ON chick_supplier_consignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read chick_delivery_notes" ON chick_delivery_notes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read chick_supplier_invoices" ON chick_supplier_invoices FOR SELECT TO authenticated USING (true);

-- Allow chick_manager, admin to insert/update
CREATE POLICY "Allow chick_manager insert chick_suppliers" ON chick_suppliers FOR INSERT TO authenticated 
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'chick_manager')));

CREATE POLICY "Allow chick_manager insert chick_purchase_orders" ON chick_purchase_orders FOR INSERT TO authenticated 
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'chick_manager')));

CREATE POLICY "Allow chick_manager update chick_purchase_orders" ON chick_purchase_orders FOR UPDATE TO authenticated 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'chick_manager')));

CREATE POLICY "Allow chick_manager insert chick_po_lines" ON chick_po_lines FOR INSERT TO authenticated 
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'chick_manager')));

CREATE POLICY "Allow chick_manager insert chick_hatch_nights" ON chick_hatch_nights FOR INSERT TO authenticated 
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'chick_manager')));

CREATE POLICY "Allow chick_manager update chick_hatch_nights" ON chick_hatch_nights FOR UPDATE TO authenticated 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'chick_manager')));

CREATE POLICY "Allow chick_manager insert chick_supplier_consignments" ON chick_supplier_consignments FOR INSERT TO authenticated 
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'chick_manager')));

CREATE POLICY "Allow chick_manager insert chick_delivery_notes" ON chick_delivery_notes FOR INSERT TO authenticated 
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'chick_manager', 'driver', 'branch_manager')));

CREATE POLICY "Allow chick_manager update chick_delivery_notes" ON chick_delivery_notes FOR UPDATE TO authenticated 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'chick_manager', 'driver', 'branch_manager')));

CREATE POLICY "Allow accountant insert chick_supplier_invoices" ON chick_supplier_invoices FOR INSERT TO authenticated 
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'accountant')));

CREATE POLICY "Allow accountant update chick_supplier_invoices" ON chick_supplier_invoices FOR UPDATE TO authenticated 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'accountant')));
