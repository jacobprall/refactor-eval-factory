ALTER TABLE eval_iterations
  ADD COLUMN IF NOT EXISTS file_changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS intervention jsonb NOT NULL DEFAULT '{"triggered":false,"applied":false,"reason":"legacy","productionChurnSinceLast":0,"hotspotPaths":[]}'::jsonb;
