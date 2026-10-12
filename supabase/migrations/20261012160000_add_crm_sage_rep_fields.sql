-- Preserve Sage sales representative information separately from CRM owner.
ALTER TABLE crm_customers
  ADD COLUMN IF NOT EXISTS sage_rep_code text,
  ADD COLUMN IF NOT EXISTS sage_rep_name text;
