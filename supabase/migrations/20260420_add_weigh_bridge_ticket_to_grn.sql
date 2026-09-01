-- Add Weigh Bridge Ticket columns to goods_received_notes table
ALTER TABLE goods_received_notes
ADD COLUMN IF NOT EXISTS wb_transaction_no varchar,
ADD COLUMN IF NOT EXISTS wb_vehicle_reg varchar,
ADD COLUMN IF NOT EXISTS wb_haulier_code varchar DEFAULT 'HYPER',
ADD COLUMN IF NOT EXISTS wb_product_code varchar,
ADD COLUMN IF NOT EXISTS wb_comment varchar,
ADD COLUMN IF NOT EXISTS wb_trailer_number varchar,
ADD COLUMN IF NOT EXISTS wb_driver_name varchar,
ADD COLUMN IF NOT EXISTS wb_driver_id varchar,
ADD COLUMN IF NOT EXISTS wb_time_in timestamptz,
ADD COLUMN IF NOT EXISTS wb_first_mass numeric(10,3),
ADD COLUMN IF NOT EXISTS wb_time_out timestamptz,
ADD COLUMN IF NOT EXISTS wb_second_mass numeric(10,3),
ADD COLUMN IF NOT EXISTS wb_nett_mass numeric(10,3),
ADD COLUMN IF NOT EXISTS wb_driver_signed boolean DEFAULT false;

-- Create indexes for weigh bridge lookups
CREATE INDEX IF NOT EXISTS idx_grn_wb_transaction_no ON goods_received_notes(wb_transaction_no);
CREATE INDEX IF NOT EXISTS idx_grn_wb_vehicle_reg ON goods_received_notes(wb_vehicle_reg);
