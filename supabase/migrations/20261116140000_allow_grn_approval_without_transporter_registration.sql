-- Transporter registration is a finance follow-up, not a prerequisite for
-- approving and queueing a goods receipt. Keep the registration workflow and
-- audit data intact while removing the database-level approval blocker.
DROP TRIGGER IF EXISTS guard_grn_pending_transporter
  ON public.goods_received_notes;
