# Refactor Eval Factory

Refactor Eval Factory measures whether an injected development procedure changes the cumulative cost of evolving software.

The focused experiment runs three shared Claude Sonnet strategies against two multi-module codebases, plus a periodic comparator on the stateful inventory target. Each cell is a sequential trajectory: the agent receives ten requirements one at a time and inherits every prior edit. Future requirements and cumulative hidden tests remain unavailable to the model.

## Intervention arms

1. `baseline` — feature request only.
2. `triggered-after` — one bounded refactor after at least six features, 200 production lines of accumulated churn, and a repeated hotspot, while at
   least four future features remain.
3. `evidence-seeking` — independently try direct and refactor-first implementations, then select by public correctness, production churn, and files touched.
4. `periodic-after` — refactor after features 3, 6, and 9 on `inventory-reservations` only.
5. `refactor-after-3`, `refactor-after-6`, and `refactor-after-9` — matched one-shot timing arms on the `usage-metering` positive control.

All arms use `claude-sonnet-5` with the same implementer, tools, turn limit, feature sequence, and sandbox boundary. Evidence selection never sees hidden tests. Every candidate and refactor call is included in operational cost.

## Runtime

- Render Workflows fans out experiment cells and keeps each target's iterations in order.
- One Render Sandbox owns each trajectory.
- Target seeds are uploaded into an isolated working directory; the factory checkout is locked away before the agent runs.
- Current-feature acceptance tests are visible before implementation. Cumulative hidden checks are uploaded only for scoring and removed before the next iteration.
- Post-refactor verification rejects changes that remove exported runtime functions, class methods, or static methods before hidden scoring.
- Postgres stores experiment, trajectory, iteration, model-usage, diff, and verification evidence. It may run locally or on Render.

A default sweep is seven trajectories. The focused experiment uses five replicates for 35 trajectories. The separate positive-control matrix is 20
trajectories: four arms at five replicates.

## Local verification

```bash
npm ci
npm run check
```

The test suite validates seed and reference codebases, asymmetric manifests, contract isolation, intervention timing, runner registration, change metrics,
and report generation. CI never calls a live model.

## Local evaluation loop

The Workflows server, manifests, prompts, target codebases, orchestration, and Postgres run locally. Only Render Sandboxes and Sonnet remain remote. Evaluation Sandboxes restore a generic runner snapshot and never clone a GitHub repository.

```bash
cp .env.local.example .env.local
# Fill in RENDER_API_KEY, RENDER_WORKSPACE_ID, and ANTHROPIC_API_KEY.

docker compose up -d postgres
npm run eval:migrate:local
npm run dev:eval
```

In another terminal, start a small sweep:

```bash
npm run eval:local -- \
  --targets inventory-reservations,notification-routing \
  --scenarios evidence-seeking \
  --max-concurrency 2
```

Source changes are picked up when the local Workflows server starts task subprocesses. Results persist in local Postgres even when the task server restarts.

The positive control starts from deliberately duplicated usage-policy paths and has a 12-feature payoff horizon. Run a two-arm sanity pilot before the
full timing matrix:

```bash
npm run eval:local -- \
  --targets usage-metering \
  --scenarios baseline,refactor-after-6 \
  --replicates 2 \
  --max-concurrency 4
```

Proceed to `baseline,refactor-after-3,refactor-after-6,refactor-after-9` at five replicates only if the known-beneficial checkpoint lowers downstream
correctness-gated churn without reducing hidden-test correctness.

Preregistered manifests in `eval/manifest.ts` run by name. `positive-control-ladder` adds a replay guard, then measured health evidence, then a playbook
to the feature-6 refactor, one factor per arm. `health-policy` compares the maturity trigger, the health gate, and the health safeguard against fresh
concurrent baselines on three targets:

`skill-review` lets the full refactoring skill (`eval/skills/talk-refactoring/`) review every feature as a pull request and decide whether to act:

```bash
npm run eval:local -- --manifest positive-control-ladder
npm run eval:local -- --manifest health-policy
npm run eval:local -- --manifest skill-review
npm run eval:local -- --manifest monolith
npm run eval:local -- --manifest combined
npm run eval:local -- --manifest coupling
```

`combined` gates one skill review behind the health or maturity trigger. `coupling` gates it behind files in different directories that keep
changing together.

`monolith` runs a six-module commerce monolith (`eval/targets/commerce/`) in three variants: planted cross-module debt with a backlog that keeps
touching it, the same debt with a backlog that never does, and a clean seed with the first backlog.

`series-2` tests the combined design: health, heat, and coupling (`app/eval/signals.ts`) decide when and where to look, and either a briefed
refactorer (`signals-only`) or the full skill (`signals-skill`) decides what to change, against `baseline` and `skill-review` on five targets.
Run `series-2-smoke` (four trajectories) first. The design, the gate's dry run on stored baselines, and the predictions are in
[EVAL_FINDINGS.md](EVAL_FINDINGS.md#series-2-signals-decide-when-and-where-the-skill-decides-what).

```bash
npm run eval:local -- --manifest series-2-smoke
npm run eval:local -- --manifest series-2
```

Relaunch an interrupted experiment with the same `--manifest` and `--experiment-id`; finished trajectories are kept.

Every checkpoint records a structural-health snapshot of production code (`app/eval/health.ts`) and the three signals: health v2, heat, and
coupling. Analyze stored experiments without model calls; checkpoints from before either was recorded are rebuilt from their stored patches:

```bash
npm run eval:analyze:local -- --experiments <id,id,...> [--target usage-metering] [--out analysis.md]
```

`npm run eval:compare-health:local -- --experiments <id,id,...>` compares the first health score with the two-axis model in
`app/eval/health-v2.ts` on the same rebuilt checkpoints.

The analysis reports interventions and hidden correctness per arm, break-even against per-feature baseline cost, health where the work is and
coupling over time, structural health by arm, whether inherited health predicts the next feature's churn and correctness, and where each adaptive
trigger would have fired on baseline trajectories.

## Deploy

1. Push this repository as `jacobprall/refactor-eval-factory`.
2. Create the `refactor-eval-shared` group with `RENDER_API_KEY` and the `refactor-eval-workflows` group with `RENDER_WORKSPACE_ID` and
   `ANTHROPIC_API_KEY` (use a spend-capped key).
3. Apply the Blueprint. It creates the `refactor-eval-workflows` service and the `refactor-eval-results` database. Workflows have no pre-deploy
   step, so each experiment applies the idempotent migrations before it writes. The first trajectory builds the generic runner snapshot; later
   trajectories restore it.

Start an experiment from your machine with `RENDER_API_KEY` and `RENDER_WORKFLOW_SLUG=refactor-eval-workflows` in `.env`:

```bash
npm run eval -- --manifest series-2-smoke
npm run eval -- --manifest series-2
```

The command prints the Workflows task-run id and experiment id. Cells run through a pool of `maxConcurrency` trajectories, so one slow trajectory
does not hold up the rest; the root run's 24-hour limit covers a full series, and a run that hits it resumes with `--experiment-id`. The
`eval-summarize-experiment` task returns structured rows and Markdown comparing each scenario with the baseline for the same target. For the full
analysis, point `DATABASE_URL` at the database's external connection string and run `npm run eval:analyze -- --experiments <id>`.

## Primary outcome

The primary outcome is correctness-gated production code churn required to complete an ordered backlog, interpreted together with:

- production additions, deletions, modules touched, and repeated hotspots;
- churn and module-touch slopes over feature order;
- cumulative hidden-test correctness and regressions;
- model turns, tokens, wall time, and USD as separate operational effort, including phases that failed or hit their turn limit;
- structural health of the code each feature inherits;
- final tree and per-iteration patch evidence.

Files touched is evidence of change propagation, not a standalone quality score.

## Safety and limits

Model-directed code runs only inside disposable Sandboxes. Hidden tests and Postgres credentials never enter the agent working directory. The replay
trace author sees only completed public requirements, and the refactorer never sees the replay script. The system records prompts by hash and bounded patches for reproducibility.

One full live sweep incurs substantial model and Sandbox cost. Start with one target and two scenarios by supplying narrowed task input before launching the full matrix.

The original GitHub issue-to-PR factory modules remain in the repository as reusable platform code but are outside the evaluation runtime path.

## License

MIT. See [LICENSE](LICENSE).
