-- Add title and person_name columns to stock_takes table
ALTER TABLE stock_takes 
ADD COLUMN IF NOT EXISTS title text,
ADD COLUMN IF NOT EXISTS person_name text;

-- Add comments
COMMENT ON COLUMN stock_takes.title IS 'Title or name of the stock take (e.g., Month-end Stock Take)';
COMMENT ON COLUMN stock_takes.person_name IS 'Name of the person responsible for the stock take';
