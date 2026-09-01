-- User-access and system-update audit records.
-- The application already writes to this table; create it so those requests no
-- longer return a PostgREST 404 error.
CREATE TABLE IF NOT EXISTS public.user_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_email TEXT NOT NULL,
  user_name TEXT,
  role TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('login', 'logout', 'page_view', 'action')),
  module TEXT NOT NULL DEFAULT 'General',
  action_details TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_access_logs_created_at
  ON public.user_access_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_access_logs_module_created_at
  ON public.user_access_logs (module, created_at DESC);

ALTER TABLE public.user_access_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can create access logs"
  ON public.user_access_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read access logs"
  ON public.user_access_logs
  FOR SELECT
  TO authenticated
  USING (auth.role() = 'authenticated');
