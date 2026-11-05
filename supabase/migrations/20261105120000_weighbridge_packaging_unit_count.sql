-- Add a separate physical package count to weighbridge tickets.
-- Existing nett_mass remains kilograms and all historical records remain NULL here.
ALTER TABLE public.weigh_bridge_tickets
  ADD COLUMN IF NOT EXISTS packaging_unit_count numeric(12, 3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'weigh_bridge_tickets_packaging_unit_count_nonnegative'
      AND conrelid = 'public.weigh_bridge_tickets'::regclass
  ) THEN
    ALTER TABLE public.weigh_bridge_tickets
      ADD CONSTRAINT weigh_bridge_tickets_packaging_unit_count_nonnegative
      CHECK (packaging_unit_count IS NULL OR packaging_unit_count >= 0);
  END IF;
END;
$$;
