ALTER TABLE eval_iterations
  ADD COLUMN IF NOT EXISTS health jsonb,
  ADD COLUMN IF NOT EXISTS refactor_health_before double precision,
  ADD COLUMN IF NOT EXISTS replay jsonb;
