CREATE TABLE IF NOT EXISTS eval_experiments (
  id uuid PRIMARY KEY,
  manifest jsonb NOT NULL,
  manifest_hash text NOT NULL,
  factory_commit text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS eval_trajectories (
  experiment_id uuid NOT NULL REFERENCES eval_experiments(id) ON DELETE CASCADE,
  target_id text NOT NULL,
  scenario_id text NOT NULL,
  target_hash text NOT NULL,
  scenario_hash text NOT NULL,
  replicate integer NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'stopped', 'failed')),
  final_tree_hash text,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (experiment_id, target_id, scenario_id, replicate)
);

CREATE TABLE IF NOT EXISTS eval_iterations (
  experiment_id uuid NOT NULL,
  target_id text NOT NULL,
  scenario_id text NOT NULL,
  replicate integer NOT NULL,
  ordinal integer NOT NULL,
  step_id text NOT NULL,
  status text NOT NULL,
  before_sha text NOT NULL,
  after_sha text NOT NULL,
  prompt_hash text NOT NULL,
  public_checks jsonb NOT NULL,
  hidden_check jsonb,
  changed_paths jsonb NOT NULL,
  additions integer NOT NULL,
  deletions integer NOT NULL,
  patch text NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (experiment_id, target_id, scenario_id, replicate, ordinal),
  FOREIGN KEY (experiment_id, target_id, scenario_id, replicate)
    REFERENCES eval_trajectories(experiment_id, target_id, scenario_id, replicate)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS eval_agent_phases (
  experiment_id uuid NOT NULL,
  target_id text NOT NULL,
  scenario_id text NOT NULL,
  replicate integer NOT NULL,
  ordinal integer NOT NULL,
  phase text NOT NULL,
  agent_id text NOT NULL,
  turns integer NOT NULL,
  usage jsonb NOT NULL,
  cost_usd double precision NOT NULL,
  duration_ms integer NOT NULL,
  output jsonb NOT NULL,
  PRIMARY KEY (experiment_id, target_id, scenario_id, replicate, ordinal, phase),
  FOREIGN KEY (experiment_id, target_id, scenario_id, replicate, ordinal)
    REFERENCES eval_iterations(experiment_id, target_id, scenario_id, replicate, ordinal)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS eval_iterations_comparison
  ON eval_iterations (experiment_id, target_id, scenario_id, ordinal);
