-- Add Product Name and Supplier to Weigh Bridge Tickets
-- These will be Sage-linked for better integration

-- Add product_name column
ALTER TABLE weigh_bridge_tickets ADD COLUMN IF NOT EXISTS product_name TEXT;

-- Add supplier_id column (FK to suppliers table)
ALTER TABLE weigh_bridge_tickets ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id);

-- Add index for supplier lookups
CREATE INDEX IF NOT EXISTS idx_wb_tickets_supplier ON weigh_bridge_tickets (supplier_id);

-- Update RLS policy to allow authenticated users to update the new columns
-- (existing policies already cover this, but documenting for clarity)
