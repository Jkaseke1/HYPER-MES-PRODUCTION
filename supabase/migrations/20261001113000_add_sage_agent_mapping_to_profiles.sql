-- Keep PlantControl people mapped to their exact active Sage Agent names.
-- The SDK uses this mapping only to set Sage's audit agent; it never stores
-- Sage passwords or changes Sage Agent records.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sage_agent_name text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_sage_agent_name
  ON public.profiles (lower(btrim(sage_agent_name)))
  WHERE sage_agent_name IS NOT NULL AND btrim(sage_agent_name) <> '';

UPDATE public.profiles
SET sage_agent_name = 'Matthew'
WHERE lower(email) = 'accounts05@hyperfeeds.co.zw'
  AND (sage_agent_name IS NULL OR btrim(sage_agent_name) = '');

NOTIFY pgrst, 'reload schema';
