-- Macropack Manufacturing Order Approval Workflow
ALTER TABLE macropack_manufacture_orders
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS rm_approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS rm_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS supervisor_approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS supervisor_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE macropack_manufacture_orders
  DROP CONSTRAINT IF EXISTS macropack_manufacture_orders_status_check;

ALTER TABLE macropack_manufacture_orders
  ADD CONSTRAINT macropack_manufacture_orders_status_check
  CHECK (status IN ('DRAFT','PENDING_RM','PENDING_SUPERVISOR','APPROVED','IN_PROGRESS','COMPLETED','REJECTED'));

-- Preserve existing records (PLANNED → APPROVED so they can start immediately)
UPDATE macropack_manufacture_orders SET status = 'APPROVED' WHERE status = 'PLANNED';
