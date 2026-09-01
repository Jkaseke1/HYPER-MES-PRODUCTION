-- Update the status check constraint on goods_received_notes to include 'rm_approved'
-- First, drop the existing constraint
ALTER TABLE goods_received_notes
DROP CONSTRAINT IF EXISTS goods_received_notes_status_check;

-- Add the new constraint with all valid status values
ALTER TABLE goods_received_notes
ADD CONSTRAINT goods_received_notes_status_check
CHECK (status IN ('pending', 'rm_approved', 'approved', 'rejected', 'inspecting'));
