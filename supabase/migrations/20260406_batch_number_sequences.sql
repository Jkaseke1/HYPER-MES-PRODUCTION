-- Create batch_sequences table for auto-incrementing batch numbers
-- This ensures sequential, auditable batch numbers across all document types

CREATE TABLE IF NOT EXISTS batch_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prefix text NOT NULL,
  year integer NOT NULL,
  next_sequence integer NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(prefix, year)
);

ALTER TABLE batch_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read batch_sequences" ON batch_sequences;
DROP POLICY IF EXISTS "Authenticated users can insert batch_sequences" ON batch_sequences;
DROP POLICY IF EXISTS "Authenticated users can update batch_sequences" ON batch_sequences;

CREATE POLICY "Authenticated users can read batch_sequences"
  ON batch_sequences FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert batch_sequences"
  ON batch_sequences FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update batch_sequences"
  ON batch_sequences FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_batch_sequences_prefix_year ON batch_sequences(prefix, year);

-- RPC function to atomically get next batch sequence number
CREATE OR REPLACE FUNCTION get_next_batch_sequence(
  p_prefix text,
  p_year integer
)
RETURNS integer AS $$
DECLARE
  v_next_sequence integer;
BEGIN
  -- Try to update existing sequence
  UPDATE batch_sequences
  SET next_sequence = next_sequence + 1,
      updated_at = NOW()
  WHERE prefix = p_prefix AND year = p_year
  RETURNING next_sequence INTO v_next_sequence;
  
  -- If no row was updated, insert new sequence starting at 1
  IF v_next_sequence IS NULL THEN
    INSERT INTO batch_sequences (prefix, year, next_sequence)
    VALUES (p_prefix, p_year, 2)
    RETURNING next_sequence INTO v_next_sequence;
    
    -- Return 1 for the first sequence
    v_next_sequence := 1;
  END IF;
  
  RETURN v_next_sequence;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comment for documentation
COMMENT ON TABLE batch_sequences IS 'Maintains sequential counters for batch number generation across all document types';
COMMENT ON FUNCTION get_next_batch_sequence(text, integer) IS 'Atomically retrieves and increments the next batch sequence number for a given prefix and year';
