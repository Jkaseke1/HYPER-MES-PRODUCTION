-- Production Stock Take relation repair.
-- The application joins stock_takes.started_by to public.profiles to show the
-- starter's name. Profiles and Auth users share the same UUID, so this changes
-- the relationship metadata only and does not modify any stock-take records.

ALTER TABLE public.stock_takes
  DROP CONSTRAINT IF EXISTS stock_takes_started_by_fkey;

ALTER TABLE public.stock_takes
  ADD CONSTRAINT stock_takes_started_by_fkey
  FOREIGN KEY (started_by) REFERENCES public.profiles(id);
