-- Add weigh bridge ticket number to GRN
ALTER TABLE goods_received_notes
ADD COLUMN IF NOT EXISTS weigh_bridge_ticket_no VARCHAR(100);

-- Attachments table for GRN files
CREATE TABLE IF NOT EXISTS grn_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  grn_id UUID REFERENCES goods_received_notes(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  file_type VARCHAR(50),
  uploaded_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for GRN attachments
CREATE INDEX IF NOT EXISTS idx_grn_attachments_grn_id ON grn_attachments(grn_id);

-- Enable RLS on grn_attachments
ALTER TABLE grn_attachments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for grn_attachments
DROP POLICY IF EXISTS "Authenticated users can read grn_attachments" ON grn_attachments;
DROP POLICY IF EXISTS "Authenticated users can insert grn_attachments" ON grn_attachments;
DROP POLICY IF EXISTS "Authenticated users can delete grn_attachments" ON grn_attachments;

CREATE POLICY "Authenticated users can read grn_attachments"
  ON grn_attachments
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert grn_attachments"
  ON grn_attachments
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete grn_attachments"
  ON grn_attachments
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- Valuation view for raw materials
CREATE OR REPLACE VIEW vw_raw_material_valuation AS
SELECT 
  rm.id,
  rm.code,
  rm.name,
  rm.category,
  rm.current_stock,
  rm.cost_per_unit,
  ROUND((rm.current_stock * rm.cost_per_unit)::numeric, 2) as valuation,
  rm.reorder_level,
  rm.is_active
FROM raw_materials rm
WHERE rm.is_active = true
ORDER BY valuation DESC;

-- Add approval_step column to track multi-step approvals
ALTER TABLE goods_received_notes
ADD COLUMN IF NOT EXISTS approval_step VARCHAR(50) DEFAULT 'pending'; -- 'pending', 'raw_material_manager_approved', 'accountant_approved'

-- Add accountant_approved_by and accountant_approved_at columns
ALTER TABLE goods_received_notes
ADD COLUMN IF NOT EXISTS accountant_approved_by UUID REFERENCES auth.users(id);
ALTER TABLE goods_received_notes
ADD COLUMN IF NOT EXISTS accountant_approved_at TIMESTAMP WITH TIME ZONE;
