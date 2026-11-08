ALTER TABLE eval_iterations
  ADD COLUMN IF NOT EXISTS signals jsonb;
