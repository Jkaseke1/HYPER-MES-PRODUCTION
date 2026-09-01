-- Add sage_code fields for Sage Pastel integration
-- This migration adds the missing sage_code fields needed for the bridge

-- Add sage_code to suppliers table
ALTER TABLE suppliers 
ADD COLUMN IF NOT EXISTS sage_code text DEFAULT '';

-- Add sage_code to raw_materials table  
ALTER TABLE raw_materials 
ADD COLUMN IF NOT EXISTS sage_code text DEFAULT '';

-- Add sage_code to branches table (should exist but let's ensure)
ALTER TABLE branches 
ADD COLUMN IF NOT EXISTS sage_code text DEFAULT '';

-- Add sage_code to formulations table (should exist but let's ensure)
ALTER TABLE formulations 
ADD COLUMN IF NOT EXISTS sage_code text DEFAULT '';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_suppliers_sage_code ON suppliers(sage_code);
CREATE INDEX IF NOT EXISTS idx_raw_materials_sage_code ON raw_materials(sage_code);
CREATE INDEX IF NOT EXISTS idx_branches_sage_code ON branches(sage_code);
CREATE INDEX IF NOT EXISTS idx_formulations_sage_code ON formulations(sage_code);

-- Add comments for documentation
COMMENT ON COLUMN suppliers.sage_code IS 'Sage Pastel supplier account code for integration';
COMMENT ON COLUMN raw_materials.sage_code IS 'Sage Pastel stock item code for integration';
COMMENT ON COLUMN branches.sage_code IS 'Sage Pastel branch code for integration';
COMMENT ON COLUMN formulations.sage_code IS 'Sage Pastel product code for integration';
