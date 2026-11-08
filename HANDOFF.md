# Handoff: what we're testing, the next experiment, and how we say it

The detailed evidence is in [EVAL_FINDINGS.md](EVAL_FINDINGS.md). This file covers only what the next person needs: the core ideas we settled on,
the experiment to run next, and the talk framing.

## The thesis

Refactoring pays when a real problem has formed where work keeps happening, and enough related work remains to repay it. In an outer loop,
**sensors decide when and where to look; judgment decides what to change, or whether to change anything.**

## First principles

### 1. Value comes from future change

A refactor is an investment repaid by later features. On the positive control (usage metering, 12 features):

- After feature 3 it never paid back: the problem had not formed yet.
- After feature 6 it cut later implementation cost by about 15% and paid back in about three features.
- After feature 9 it saved as much per feature but ran out of backlog.
- Repeated hotspot-driven refactoring broke established behavior and needed about 27 features to pay back.

### 2. Three questions, three signals

Each question has one simple, explainable signal with an external threshold:

| Question | Signal | Definition |
|---|---|---|
| Is it hard to change? | **Health** (`app/eval/health-v2.ts`) | 10 minus penalties, floored at 1. Cognitive complexity per function (SonarSource; each point above their default limit of 15 costs 0.2). Copies that still match after renaming (at least 50 tokens, jscpd's default; each tenth of a file's lines in a copy costs 1). Imports and type declarations are ignored. |
| Do we change it often? | **Heat** | How many of the last 6 features touched the file. |
| Does changing it drag something else along? | **Coupling** | The largest set of files, spanning 2+ directories, that some 3 of the last 4 features all changed. Barrel (`index.*`) and type-module files are excluded. |

The headline number is **health where the work is**: file health weighted by size times heat.

How the signals combine:

| | Rarely changed | Often changed |
|---|---|---|
| **Hard to change** | Leave it alone: the cost is real, but nobody pays it | Refactor now |
| **Easy to change** | Fine | Keep it healthy (review, safeguards) |

Coupling adds a pointer: when a cluster keeps changing together, the problem lives across those files, not inside any one of them.

### 3. Sensors and judgment see different things

| Problem | Health sees it | Coupling sees it | The skill sees it |
|---|---|---|---|
| Copied logic inside one file (usage metering's `record` and `preview`) | Yes | No | Yes |
| One rule written differently in two modules (the monolith's two pricing copies) | No | Yes: those two files change together in 63% of features | Yes |
| The same debt, sitting where no feature touches it | No signal, correctly | No signal, correctly | Flags it anyway |
| Real bugs (a rejected reservation losing stock) | No | No | Yes |

Each has a gap:
- **Sensors** time things well and stay quiet on healthy code, but they can't see knowledge duplicated in different-looking code.
- **The skill** finds the right targets but has no brake. Reviewing every feature, it acted on 40–90% of them, cost about $5–6 per run, and later features did not get cheaper.

That gap is the reason for the combined design.

### 4. Safety is a precondition, not a feature

Every refactor runs behind a **replay guard**. A separate agent writes a deterministic replay from public requirements only, so hidden tests stay hidden. The harness hides that script from the refactorer, and any change in output rolls the refactor back. The output is compared with object keys sorted, so a reordered field doesn't count as a behavior change.

The guard costs more than the refactor it protects, and it rejected about 2 in 30 refactors. The only series-1 failure that coincided with a refactor was in an arm without the guard.

Open check: the skill-review arm on notification routing passed 54 of 92 hidden checks. Confirm whether refactors caused those failures before citing the guard as a safety result.

### 5. Measurement hygiene we committed to

- **No heuristics tied to our own layout.** Boundary violations against `index.ts`, and repeated rule tables, matched exactly how we planted the debt, so we dropped them.
- **Thresholds come from outside our data** (SonarSource, jscpd). Every rule and weight is fixed before comparing against outcomes. Any change made after a run is written down; one already was, the size-times-heat weighting.
- **Predictions are written into `EVAL_FINDINGS.md` before each run.**
- **Series 1 arms keep the first health score,** so their results stay comparable. Series 2 uses v2 throughout.

## The next experiment (series 2, built and ready to deploy)

Built as the `series-2` manifest (`signals-only` and `signals-skill` are the new arms; the gate is in `app/eval/signals.ts`). The design as built,
a dry run of the gate on stored baselines, and the predictions are in
[EVAL_FINDINGS.md](EVAL_FINDINGS.md#series-2-signals-decide-when-and-where-the-skill-decides-what).

**Question:** in an outer loop, does "signals decide when and where, the skill decides what" beat no refactoring, beat the skill reviewing every pull request, and beat signals acting alone?

**Arms:**
1. **Baseline:** no refactoring.
2. **Skill on every pull request:** judgment alone, the no-brake comparison.
3. **Signals only:** when the signals gate fires, a briefed refactorer receives the signal (the hot file with its complex functions and copied lines, or the coupled cluster) and makes one bounded refactor.
4. **Signals plus skill:** when the gate fires, the skill reviews the last four features as one pull request, starting from the named files, and decides what to do or declines.

**Gate:** it fires when a hot file (touched in 3 of the last 4 features) is below health 9.5 and got worse during the window, or when a coupling cluster forms, and at least four features remain. It is one-shot, the safer and already-tested shape; re-arming four features after each review is not built.

**Targets** (each chosen to make a point):
- **Usage metering:** copies within a file, which health sees.
- **Commerce monolith:** a rule duplicated across modules, which coupling sees.
- **Commerce monolith, features elsewhere:** the same debt with no future work on it, so leaving it alone is right.
- **Commerce monolith, clean seed:** nothing should fire.
- **Inventory:** small and healthy.

At 10 runs each: 4 arms × 5 targets × 10 = 200 trajectories.

**Measures:** attempted churn, later-feature cost and break-even, hidden-test correctness (the gate for every other claim), health where the work is over time, coupling clusters over time, number of interventions, and cost.

**Harness polish before running (done):**
- v2 health, heat, and coupling are recorded at every checkpoint (`signals` on each iteration).
- The `signals-only` refactor message says the feature is committed as `HEAD`; series 1 arms keep the old wording so they stay comparable.
- Every series 2 refactor arm uses the key-sorted replay comparison.

**Predictions to write down before the run:**
1. Signals plus skill reaches the planted debt in both usage metering and the messy monolith, about once per run, and leaves the elsewhere, clean, and inventory targets alone.
2. It matches or beats signals only on later-feature cost, because the skill picks better targets.
3. It costs a fraction of skill on every pull request, at equal or better health.
4. Signals only misses the monolith debt when the gate fires on health, and finds it when the gate fires on coupling.

## How we say it in the talk

The title's promise: *when to refactor, when to leave working code alone, and how to make refactoring part of the workflow so agents leave codebases better, not just bigger.*

**Story beats:**
1. **Rot is measurable.** Without refactoring, health on the positive control falls from 9.5 to about 6.4 over 12 agent features. Healthy projects stay healthy.
2. **One well-timed refactor pays; badly timed or repeated ones don't.** After feature 3: nothing. After feature 6: it pays back in about three features. Refactoring repeatedly breaks things.
3. **Three questions:** is it hard to change, do we change it often, and does changing it drag something else along?
4. **"Hard but cold: leave it alone."** Leaving working code alone comes out of the rule; it doesn't need a separate rule. The same debt with no future work on it never triggers anything.
5. **Sensors for timing, judgment for targets.** Metrics see complexity and copies; the skill sees duplicated knowledge, boundaries, and bugs. Alone, the skill has no brake; alone, the metric is blind to the problems that matter most in a modular codebase.
6. **Safety first.** A refactor is behavior-preserving or it doesn't ship: the replay guard.
7. **The playbook:** an agent that leaves a recipe makes later agents extend the consolidated structure instead of re-copying it. After the refactor, new duplicated blocks fell from 4.5 to about 1.5.

**Phrases that work:**
- "Health where the work is."
- "Does changing it drag something else along?"
- "Sensors decide when and where to look; judgment decides what."
- "The metric can't see the duplicate, but the history can: those two files always change together."

**Say on stage:** the projects are small and synthetic, every run used one model family, the positive control was designed to reward refactoring, and churn differences sit near a roughly 10% noise floor. Health and later-feature cost are the clearer signals.

## Where things stand

- **Series 1 is stopped.** The ladder and health-policy experiments finished. Skill-review (69 of 100), combined (33 of 90), monolith (12 of 180), and coupling (9 of 60) were cancelled mid-run. All results are in local Postgres; experiment IDs are in `EVAL_FINDINGS.md` and the `eval_experiments` table. The local workflow server is stopped.
- **Deployment is blocked on three human steps:**
  1. Create the GitHub repo `jacobprall/refactor-eval-factory` (`render.yaml` deploys from it) and push.
  2. Refresh the Render CLI login (`render login`), or use `RENDER_API_KEY`.
  3. Apply the Blueprint and fill in the `refactor-eval-shared` and `refactor-eval-workflows` env groups (`RENDER_API_KEY`, `RENDER_WORKSPACE_ID`, `ANTHROPIC_API_KEY`).

  The Blueprint creates its own results database, so series 2 data will live on Render. Workflows have no pre-deploy step, so each experiment migrates the database before it writes. Point the analysis scripts at it with `DATABASE_URL`.
  Then run `npm run eval -- --manifest series-2-smoke` (four trajectories), check the briefs and reviews, and launch `npm run eval -- --manifest series-2`. Expect roughly 10 hours at 12 concurrent trajectories and on the order of $450–500 in model cost, most of it the skill-on-every-PR arm.
- **Useful commands:**
  - `npm run eval:analyze:local -- --experiments <ids>`: break-even, health, and trigger dry runs.
  - `npm run eval:compare-health:local -- --experiments <ids>`: v1 versus v2 health on rebuilt checkpoints.
  - `npm run eval:local -- --manifest <name> [--experiment-id <id>]`: launch, or resume an interrupted run.
- **Gotchas:**
  - The local dev server keeps worker subprocesses running after a cancel. Stop the server to actually end runs.
  - Editing source while runs are in flight changes the code new trajectories load, so stage edits in a copy.
  - The sandbox service had outage windows; every experiment resumes by ID.
