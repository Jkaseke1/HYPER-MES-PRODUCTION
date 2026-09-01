-- Production temporary labour and payroll foundations.
-- Schema only: creates no workers, attendance, payroll, advance, or payment records.
-- External payments: none. This migration does not contact or queue EcoCash.

CREATE TABLE IF NOT EXISTS public.temporary_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_number text UNIQUE NOT NULL,
  full_name text NOT NULL,
  phone_number text NOT NULL,
  national_id text,
  department text,
  status text NOT NULL DEFAULT 'active',
  hire_date date NOT NULL DEFAULT current_date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_number text UNIQUE NOT NULL,
  period_type text NOT NULL DEFAULT 'weekly',
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'open',
  total_workers integer NOT NULL DEFAULT 0,
  total_hours numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  paid_by uuid REFERENCES public.profiles(id),
  paid_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS public.worker_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL REFERENCES public.temporary_workers(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  clock_in timestamptz,
  clock_out timestamptz,
  hours_worked numeric,
  overtime_hours numeric NOT NULL DEFAULT 0,
  department text,
  supervisor_id uuid REFERENCES public.profiles(id),
  production_order_id uuid REFERENCES public.production_orders(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (worker_id, work_date)
);

CREATE TABLE IF NOT EXISTS public.payroll_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_period_id uuid NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.temporary_workers(id) ON DELETE CASCADE,
  total_hours numeric NOT NULL DEFAULT 0,
  overtime_hours numeric NOT NULL DEFAULT 0,
  hourly_rate numeric NOT NULL DEFAULT 0,
  overtime_rate numeric NOT NULL DEFAULT 0,
  gross_amount numeric NOT NULL DEFAULT 0,
  deductions numeric NOT NULL DEFAULT 0,
  net_amount numeric NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'ecocash',
  ecocash_number text,
  payment_status text NOT NULL DEFAULT 'pending',
  ecocash_transaction_id text,
  payment_date timestamptz,
  payment_error text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_period_id, worker_id)
);

CREATE TABLE IF NOT EXISTS public.worker_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL REFERENCES public.temporary_workers(id) ON DELETE CASCADE,
  advance_date date NOT NULL DEFAULT current_date,
  amount numeric NOT NULL,
  reason text,
  approved_by uuid REFERENCES public.profiles(id),
  deducted_amount numeric NOT NULL DEFAULT 0,
  balance numeric,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ecocash_payment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_period_id uuid NOT NULL REFERENCES public.payroll_periods(id),
  batch_number text UNIQUE NOT NULL,
  total_payments integer NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  successful_payments integer NOT NULL DEFAULT 0,
  failed_payments integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  initiated_by uuid REFERENCES public.profiles(id),
  initiated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text,
  ecocash_batch_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_period_id uuid REFERENCES public.payroll_periods(id),
  worker_id uuid REFERENCES public.temporary_workers(id),
  action text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid REFERENCES public.profiles(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_temporary_workers_status ON public.temporary_workers(status);
CREATE INDEX IF NOT EXISTS idx_worker_attendance_date ON public.worker_attendance(work_date);
CREATE INDEX IF NOT EXISTS idx_worker_attendance_worker ON public.worker_attendance(worker_id);
CREATE INDEX IF NOT EXISTS idx_payroll_periods_dates ON public.payroll_periods(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_period ON public.payroll_lines(payroll_period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_worker ON public.payroll_lines(worker_id);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_status ON public.payroll_lines(payment_status);
CREATE INDEX IF NOT EXISTS idx_payment_batches_period ON public.ecocash_payment_batches(payroll_period_id);

DO $schema_security$
DECLARE
  relation_name text;
  policy_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'temporary_workers', 'payroll_periods', 'worker_attendance',
    'payroll_lines', 'worker_advances', 'ecocash_payment_batches',
    'payroll_audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    policy_name := 'Authenticated users manage ' || relation_name;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, relation_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      policy_name,
      relation_name
    );
  END LOOP;
END
$schema_security$;

NOTIFY pgrst, 'reload schema';
