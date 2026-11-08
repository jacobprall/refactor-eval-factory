# Refactoring evaluation findings

## Executive summary

The experiments show that refactoring can reduce the downstream cost of change, but only under a specific combination of conditions:

- a concept has repeated enough to expose a stable structural problem;
- the refactor consolidates that repeated decision path;
- enough related work remains to repay the one-time structural cost; and
- the intervention is bounded and protected against regressions.

On the positive-control usage-metering target, a one-time refactor near the midpoint of a 12-feature backlog reduced downstream attempted production
churn by about 19% while preserving correctness. Refactoring too early produced essentially no benefit, while refactoring late produced a smaller benefit.

Broad or repeated adaptive refactoring was harmful. The original hotspot policy refactored three times per trajectory and broke previously established
idempotency behavior in half the runs. A revised one-shot maturity policy restored full correctness and reduced total attempted churn by 8.6% versus
baseline.

These results establish that the harness can detect refactoring value when a payoff mechanism exists. They do not yet establish that the calibrated
policy generalizes to ordinary targets.

## What we measured

The primary change-cost measure is production code churn:

> production additions + production deletions

Refactor lines are included in this cost. Tests, configuration, and generated evaluation files are classified separately.

We interpret churn together with:

- cumulative hidden-test correctness;
- completed versus stopped trajectories;
- production files touched and repeated hotspots;
- change-cost slope over feature order;
- model tokens, duration, and USD; and
- the timing and outcome of every refactor call.

For later experiments, **attempted churn** became the primary structural measure. It includes work from failed features, preventing a failed arm from
appearing artificially cheap because correctness-gated reporting excludes its failed iteration.

## Findings by experiment

### 1. Broad cadence interventions were not generally beneficial

The first focused cadence pilot compared baseline with always-after, periodic-after, and triggered-after refactoring.

- Always-after was dominated: it cost about 83% more and increased aggregate churn by about 6%.
- Triggered-after was the least expensive intervention, but it did not consistently reduce churn across targets.
- Effects varied by target architecture, which argued against treating refactoring frequency as a universal policy.

This eliminated “refactor after every feature” from further study.

### 2. Evidence-seeking was too expensive

The evidence-seeking arm independently tried direct implementation and refactor-first implementation for each feature, then selected using public
correctness, production churn, and files touched.

- It reduced churn modestly: about 11% on inventory and 5% on routing.
- It cost roughly 2.6–2.8 times baseline.
- Direct implementation won 75 of 100 comparisons.
- Refactor-first won 25 comparisons, but only five selected paths contained an applied preparatory refactor.
- It did not prevent the routing hidden-test failure seen in baseline.

Conclusion: evidence-seeking is useful as a diagnostic procedure, not as a default development policy.

### 3. The initial routing correctness signal did not replicate

In the five-replicate experiment, routing baseline and evidence-seeking each suffered a five-feature failure cascade after an incorrect channel-limit
implementation. Triggered-after passed all 50 routing features.

A 10-pair confirmation did not reproduce that difference:

- baseline: 100/100 hidden checks;
- triggered-after: 100/100 hidden checks;
- triggered-after churn: 4.1% higher;
- triggered-after cost: 13.4% higher.

The original apparent correctness advantage came from one cascading defect in one replicate, not a stable treatment effect.

### 4. A positive control demonstrated real downstream value

We added a 12-feature usage-metering target with deliberately repeated policy logic and a known behavior-preserving refactor: consolidate record and
preview decisions into a shared evaluation path after the policy had matured.

The first two-pair pilot showed a 21.7% downstream attempted-churn reduction, but one final hidden failure in the refactor arm. Following the preregistered
gate, we stopped rather than interpreting correctness-gated churn.

The subsequent 10-pair stability run cleared the gate:

- baseline: 119/120 hidden checks and 9/10 completed trajectories;
- refactor after feature 6: 120/120 hidden checks and 10/10 completed trajectories;
- downstream attempted churn: 19.1% lower;
- total attempted churn: 6.6% lower;
- change-cost slope: 19.2% lower;
- refactoring lowered downstream churn in 8 of 10 replicate-number comparisons.

This is the strongest evidence that the harness can detect refactoring value.

### 5. Timing mattered

We compared matched one-shot refactors after features 3, 6, and 9.

- After feature 3: total attempted churn was 0.4% below baseline. This was effectively no benefit.
- After feature 6: total attempted churn was 6.6% below baseline, with the lowest cost and flattest churn slope.
- After feature 9: total attempted churn was 4.3% below baseline. The refactor helped, but only three later features remained.

The relationship was not “earlier is better.” The useful intervention point occurred after the repeated policy path had become clear and while six
related features remained.

### 6. The original adaptive trigger was unsafe

The original adaptive policy triggered from either a repeated hotspot or accumulated churn. On usage metering it fired after features 4, 7, and 10 in
every trajectory.

- It made 30 refactor calls instead of 10.
- Five feature-7 refactors removed or damaged established idempotency behavior.
- Those regressions persisted through later cumulative checks.
- Hidden correctness fell to 90/120.
- It cost 12.8% more than the one-shot feature-6 oracle.

Hotspot recurrence alone was too eager, and resetting trigger history allowed the same files to cause repeated interventions.

### 7. A one-shot maturity trigger succeeded

We replaced the repeated hotspot rule with a one-shot gate requiring:

- at least six completed features;
- at least 200 accumulated production lines of churn;
- a production file touched in three of the last four features; and
- at least four future features remaining.

We also added exported-runtime-API protection around post-refactors. A refactor that removes an exported function, class method, or static method is
rolled back to the implementation checkpoint. Additive internal helpers remain allowed.

In the 10-replicate primary run:

- all 10 trajectories completed;
- all 120 hidden checks passed;
- the trigger fired after feature 6 in seven trajectories and feature 7 in three;
- exactly one refactor was applied per trajectory;
- total attempted churn was 8.6% below baseline;
- total attempted churn was 2.2% below the fixed feature-6 arm;
- features 7–12 churn was 1.4% above the feature-6 arm; and
- recorded cost was 3.0% above the feature-6 arm but slightly below recorded baseline cost.

The adaptive policy successfully located the useful window on the target where it was calibrated.

## What the results support

The evidence supports these claims:

1. Refactoring can create measurable downstream value when later changes repeatedly exercise the structure being improved.
2. The one-time refactor cost can be recovered within a finite backlog.
3. Timing depends on both **debt maturity** and **remaining payoff horizon**.
4. Repeated hotspot-based refactoring is not safe by default.
5. Correctness must dominate churn in treatment selection and interpretation.
6. Attempted churn is necessary alongside correctness-gated churn.
7. A bounded, one-shot intervention can be operationally competitive with baseline.

## What the results do not support

The experiments do not show that:

- refactoring is beneficial on average across repositories;
- 200 lines is a portable maturity threshold;
- the policy generalizes beyond the usage-metering positive control;
- lower churn necessarily means better maintainability;
- the result holds for other models, prompts, languages, or harnesses; or
- prototype/API-surface compatibility is sufficient to guarantee behavior preservation.

## Important limitations

### Target and model scope

The positive result comes from one synthetic target intentionally designed with a known repeated-policy refactor. All live experiments used the same
model family and agent procedure.

### Weak pairing

Replicate numbers identify matching cells but do not seed model sampling. Some arms were run in successive experiments rather than one concurrent
randomized block, leaving possible time-of-run or service drift.

### Small samples

Most comparisons used five or ten replicates. Pair-level churn remained noisy, even when direction was consistent.

### Metric coverage

Line churn captures implementation effort but not readability, conceptual integrity, review effort, onboarding cost, or long-term defect prevention.
Files touched did not improve materially in the positive-control experiments. The structural-health proxy adds a measure of the inherited state, but it
covers function-level and duplication smells only, not module boundaries or naming, and it is not CodeScene's Code Health.

### Verification limits

Exported-runtime-API protection catches removals but not semantic regressions behind an unchanged signature. Hidden tests correctly exposed this gap in
the original adaptive policy. The replay guard targets this gap but has not run live; it is only as strong as the cases the trace author writes, and a
nondeterministic trace falls back to API protection.

### Incomplete failed-phase cost

Before this change, an agent that reached its turn limit without submitting left no agent phase, so recorded cost for an arm containing such a
failure is a lower bound. New runs record what the runner reported for failed phases. Stored experiments remain lower bounds.

### Refactor prompt wording

The post-refactor message tells the agent to inspect "the current uncommitted diff," but the harness commits the implementation checkpoint before the
refactor runs, so that diff is empty and the feature is `HEAD`. The wording is kept unchanged so new arms stay comparable with the stored
`refactor-after-*` runs; fix it in all arms together when starting a fresh series. Series 2 does: its only arm that uses this message,
`signals-only`, says the feature is committed as `HEAD` and names its diff.

### Calibrated trigger

The maturity gate was designed using observations from the positive-control target. Its success on that target is not an out-of-sample validation.
The health gate's thresholds come from the talk and were fixed before any analysis, but its usage-metering dry run uses the same target and is
in-sample in that sense; inventory and routing are the out-of-sample tests.

## Lessons from "AI-friendly code" (Adam Tornhill)

Tornhill's talk ([video](https://youtu.be/ciRTdOIhNCc)) reports CodeScene's research on how code quality affects coding agents. His claims line up with
ours on the problem and differ on the policy, which makes them a useful foil.

### What the talk claims

- Agentic speedups decay. In a study of about 1,000 open-source projects, an initial velocity gain from AI adoption was fully cancelled within two
  months, attributed to rising code complexity. An Alibaba maintenance benchmark found agents succeed on isolated tasks and break down over simulated
  months because "the consequences of past decisions accumulate." Our trajectory harness is the same design at a smaller scale.
- An objective structural metric predicts agent failure. On CodeScene's 1–10 Code Health scale, agents broke tests about 60% more often at 9.0 than at
  10.0, so the AI-friendly bar is at least 9.5. Healthy code used 40–45% fewer tokens per feature.
- Without a measured target, models refactor timidly: about 50% of issues fixed in poor code, about 20% in decent code, mostly renames. With the health
  findings supplied, results improved sharply.
- Large-scale uplift worked because of two harness features: a replay trace that compared frame hashes before and after every refactor, and a
  refactoring playbook in which the agent recorded each successful refactoring's conditions, constraints, and mechanism. Narrow, codebase-specific
  recipes bridged local problems to generic refactorings; a broad instruction such as "apply Strategy" would not have scaled.
- He safeguards every AI edit in the inner loop: score health after each change and self-correct until healthy.
- God classes concentrate parallel agents in the same files, so recurring merge conflicts are an architecture signal.

Most figures come from CodeScene's own research, and CodeScene sells Code Health. The Street Fighter uplift case study is unpublished. Treat the numbers
as hypotheses to test, not as calibration constants.

### How the claims map onto our results

| Talk claim | Our evidence | Implication |
|---|---|---|
| Refactor everything to 10.0 | After feature 3, a refactor did nothing; repeated refactoring broke idempotency | Value depends on remaining change; his business case is also paid back by future features |
| Agents refactor timidly without data | Evidence-seeking: 25 refactor-first wins, five with an applied refactor | Brief the refactorer with measured evidence |
| Replay harness made refactoring safe | API-surface protection missed semantic regressions | Add differential replay without exposing hidden tests |
| Healthy code is cheaper per feature | We record tokens but report churn | Report downstream token savings and break-even |
| Safeguard every edit | Always-after cost +83% and raised churn | Test a health-gated safeguard rather than a fixed cadence |

### Recommended changes

1. **Measure structural health at every checkpoint.** Churn measures effort, not the state the next agent inherits. Add a deterministic, transparent
   health proxy over production files: function length, cyclomatic complexity, nesting depth, bumpy-road nesting, complex conditionals, argument count,
   duplicated blocks, and file size, scored from 10 down to 1. Test whether health before feature k predicts churn and hidden failures at feature k,
   within feature ordinal. If it does, health becomes a leading indicator rather than an outcome.
2. **Make the maturity trigger health-aware.** Tornhill defines a hotspot as frequent change combined with poor health. Our original trigger used
   frequency alone and was too eager; our revised trigger relies on a 200-line constant that is unlikely to port. A health gate fires once when a
   repeated hotspot is below the 9.5 bar, gained at least one structural finding during the last four features, and at least four features remain.
   The thresholds are taken from the talk and fixed before any run, not tuned on usage metering.
3. **Brief the refactor agent with measured evidence.** The current post-refactor prompt gives the skill and a general mandate. Supply the hotspot
   paths, per-file health, and specific findings, with the goal of raising health without changing behavior or splitting code to satisfy a metric.
4. **Guard refactors with differential replay.** After the implementation checkpoint, a separate agent writes a deterministic replay script from the
   completed public requirements only. The harness runs it twice on the checkpoint (rejecting nondeterministic traces), hides it from the refactorer,
   and reruns it after the refactor. Any output difference rolls the refactor back. Exported-API protection stays as a cheaper first check.
5. **Let the refactorer leave a playbook.** When a refactor is applied, the agent appends a short recipe to `PLAYBOOK.md`: name, conditions,
   constraints, mechanism, and location. Later implementers read it. The hypothesis is that features 7–12 extend the consolidated path instead of
   duplicating it again.
6. **Report downstream tokens and break-even.** For each trajectory with an intervention, compare post-intervention implementation cost against the
   per-ordinal baseline mean, net of the intervention's own cost. This turns "the refactor cost can be recovered within a finite backlog" into dollars
   and a break-even feature count, and it runs on stored data.
7. **Test the safeguard loop as its own arm.** Trigger a bounded refactor after any feature that added a structural finding to a touched file, limited
   to the new findings. This tests whether continuous health-gated safeguarding pays for itself or whether one well-timed refactor is better.
8. **Later: parallel agents.** Our trajectories are sequential, while software-factory runs agents concurrently. Start N features from one base and
   compare conflict rates before and after a refactor to test the god-class claim.

### Arms

Each fixed-timing arm adds one factor to the one before it, so adjacent arms isolate one change:

| Arm | Trigger | Replay guard | Evidence brief | Playbook |
|---|---|---|---|---|
| `refactor-after-6` (existing control) | After feature 6 | | | |
| `refactor-after-6-guarded` | After feature 6 | Yes | | |
| `refactor-after-6-briefed` | After feature 6 | Yes | Yes | |
| `refactor-after-6-playbook` | After feature 6 | Yes | Yes | Yes |
| `health-triggered` | One-shot health gate | Yes | Yes | |
| `health-safeguard` | Any feature that adds a finding | Yes | New findings only | |

Two preregistered manifests run these: a 10-replicate positive-control ladder on usage metering, and a 10-replicate health-policy comparison on usage
metering, inventory reservations, and notification routing with fresh concurrent baselines and the existing maturity trigger.

### Retrospective results from stored experiments

These come from `npm run eval:analyze:local` over the stored runs, with no new model calls. Checkpoints were rebuilt by replaying each iteration's
stored patch onto the target seed and measured with the new health sensor.

**Break-even on usage metering.** The table compares implementation cost after each trajectory's refactor with the baseline's mean cost for the same
features, net of what the refactor phases cost (means per trajectory, 10 trajectories per arm):

| Arm | Refactor after feature | Refactor cost | Downstream implementation cost vs baseline | Net savings | Break-even features |
|---|---:|---:|---:|---:|---:|
| `refactor-after-3` | 3 | $0.059 | +2.3% | −$0.090 | never |
| `refactor-after-6` | 6 | $0.074 | −11.3% | +$0.044 | 3.8 of 6 remaining |
| `refactor-after-9` | 9 | $0.085 | −12.1% | −$0.005 | 3.2 of 3 remaining |
| Original adaptive trigger (three refactors) | 4 (first) | $0.205 | −5.0% | −$0.143 | 26.7 |
| Revised maturity trigger | 6.3 | $0.087 | −10.6% | +$0.019 | 4.7 of 5.7 remaining |

The refactor after feature 6 pays for itself in about four features and has six to work with. The refactor after feature 9 saves as much per feature
but runs out of backlog at the break-even point. The refactor after feature 3 never pays back. The original adaptive trigger would need 27 features to
repay its three refactors. On inventory and routing, the older trigger versions never paid back (downstream cost +0.5% to +2.3%). Absolute dollars are
small because the targets are small; the ratios carry the result. Tornhill's 40–45% token saving is a different comparison (healthy versus unhealthy
code); ours is about 11% from one bounded refactor.

**Structural health by arm.** Usage metering starts at 9.52, below the AI-friendly bar, because of the planted duplication in `src/meter.ts` (8.5).
Baseline trajectories decay to a mean of 7.35 by feature 12. Every refactor arm ends healthier (7.64 to 8.36), and the feature-6 arm is healthiest at
feature 6 (9.70 versus 9.27). Inventory and routing stay at 9.8 or higher in every arm.

**Inherited health predicts the next feature's churn.** Within the same feature ordinal on baseline trajectories, the correlation between inherited
health and the next feature's attempted churn is −0.23 on usage metering (110 features), −0.35 on inventory (45), and −0.15 on routing (135). The
direction is consistent and the effect is modest. Features within one trajectory are not independent, and an agent's style may drive both health and
churn, so this is suggestive rather than causal. The single usage-metering baseline hidden failure followed inherited health of 6.21 against a mean
of 9.03. Routing failures followed health of 9.94: the channel-limit defect is not a structural problem.

Correction from the larger health-policy run (fresh baselines, 81 to 108 features per target): the baseline correlation held on usage metering
(−0.28) but vanished on inventory (−0.06) and routing (+0.01), where health barely moves from 9.8 to 10. Treat it as an effect that appears once
code health actually degrades, not as a general result across all three targets.

**Trigger dry run on baseline trajectories.**

- On usage metering, the health gate fires after feature 6 in 7 of 10 trajectories, exactly where the maturity gate fires. It fires after feature 8 in
  2 (maturity: 7) and after feature 4 in 1. It lands in the useful window without a line-count constant.
- It fires on `src/policy.ts`, where `validatePlan` and `evaluateUsage` accumulate complexity, not on `src/meter.ts`, where the duplication was
  planted. `meter.ts` starts at 8.5 and seldom gains new findings. The brief will therefore point the refactorer at policy complexity, which may or may
  not be the high-payoff refactor; the ladder's briefed arm measures this.
- On inventory and routing, neither gate would fire: no hotspot is below 9.5. "Leave working code alone" falls out of the gate rather than needing its
  own rule.
- The safeguard would fire 4 to 6 times per usage-metering trajectory and at most once per routing trajectory.

### Predictions before the live runs

1. Replay guard: fewer applied refactors than `refactor-after-6`, no hidden regressions introduced by a refactor, and similar downstream savings.
2. Evidence brief: more substantive refactors (fewer no-ops and renames) and lower downstream churn than the guarded arm, unless the brief's focus on
   `policy.ts` steers away from the duplicated record and preview paths.
3. Playbook: lower churn in features 7–12 than the briefed arm, measured by less re-duplication in `meter.ts` and `policy.ts`.
4. Health gate: fires near feature 6 on usage metering and almost never on inventory or routing, so its cost there matches baseline.
5. Safeguard: highest intervention cost of the adaptive arms on usage metering; net savings negative unless its refactors are cheap and the replay
   guard keeps them safe.

### The talk's skill as the decision-maker

The arms above test the machinery around a refactoring decision, with the harness choosing when. The `skill-review` arm tests the talk's actual
claim: the full refactoring skill (vendored at `eval/skills/talk-refactoring/`, 16 smell cards, 35 refactor cards, `recon.py`, and the scoring rubric)
reviews every feature as a pull request in diff scope and decides. The harness applies the skill's highest-ranked finding only when the skill labels it
`now` or `next-change`, its confidence is not low, its risk is not high, every plan step preserves behavior, and it does not sit in a harness-owned
acceptance test. An applier agent follows the skill's "Applying a recommendation" procedure behind the replay guard; a guard rollback is written to the
skill's ledger as a rejection. The `skill-review` manifest compares it with fresh baselines, the health gate (metric only), and the briefed feature-6
refactor (best fixed timing) on all three targets.

Smoke-run observations (one trajectory each on usage metering and inventory, before the full run):

- The review ran the skill's pipeline in about 20 turns and 2 minutes per feature.
- On inventory feature 1 it confirmed a real defect by running it: `reserve()` decrements stock before validation, so a rejected reservation loses
  stock permanently. The fix changes failure behavior, so the rule correctly did not apply it.
- On inventory features 2 and 3 it acted on `reinvented-logic` findings in healthy code. The skill's `next-change` rule ("the site is in a hotspot or
  churned in the window") cannot discriminate in a repository whose entire history is one day old.
- On usage metering feature 1 it chose a finding in the harness-owned acceptance test, which the harness overwrites; the decision rule and prompts now
  exclude those files.

Predictions before the full run:

1. On usage metering, the skill acts on the duplicated record and preview decision paths by feature 7, which the health gate does not target.
2. On inventory and routing, it acts several times on healthy code, so its cost and churn exceed baseline while health is unchanged: its `when`
   judgment is miscalibrated for young repositories.
3. Findings it labels `now` with behavior-changing plans (bugs, not refactors) precede hidden-test failures more often than chance.
4. On usage metering, its downstream savings match or exceed the health gate's if it targets the duplication.

### A modular monolith target

The earlier targets are single-module libraries of 250–450 lines, so cross-module smells (scattered knowledge, reach-ins, inconsistent
solutions across modules) barely appear. The `commerce-monolith` family is a store with six modules written in deliberately different styles:
a repository class (`catalog`), factory functions (`accounts`), a service class (`orders`), a rules pipeline (`billing`), an event subscriber
(`notifications`), and a shared kernel. Its README documents the boundary rule: modules depend on each other only through
`src/<module>/index.ts`.

Three targets share one reference solution, which passes every cumulative test of both backlogs:

| Target | Seed | Backlog |
|---|---|---|
| `commerce-monolith` | Planted debt | 12 features that keep working through the debt |
| `commerce-monolith-elsewhere` | The same planted debt | 12 features in catalog, accounts, and two new modules |
| `commerce-monolith-clean` | Well-factored | The same 12 features as `commerce-monolith` |

The planted debt is one pricing policy written twice (a function in `orders`, a rules pipeline in `billing`) and kept in agreement by
the composition root; `notifications` reading the orders module's internal store; and a grab-bag `shared/utils.ts`. Hidden tests check that
every order and its invoice agree, so each pricing feature in the first backlog must change both copies and their wiring. The second backlog
never touches pricing or notifications, so the same debt costs nothing there and leaving it alone is right.

The structural-health sensor is nearly blind to this debt: it scores the debt seed 9.94 against 10.0 for the clean seed, seeing only
the duplicated line-type declarations, because the pricing copies differ in shape and the reach-in looks like any other import. A
separate module-boundary measure, recorded beside the score and never folded into it, counts imports that bypass a module's `index.ts`: one in
the debt seed, none in the clean seed. The `monolith` manifest runs baseline, the maturity gate, the health gate, and the skill review on all
three targets.

Predictions before any run:

1. On `commerce-monolith`, baseline churn per feature exceeds `commerce-monolith-clean`, and order and invoice disagreements cause more hidden
   failures, because every pricing change must be made twice.
2. Boundary violations grow in debt-seed baselines and stay near zero in clean-seed baselines: agents copy the reach-in they find.
3. The health gate rarely fires on the debt seed early, because the metric cannot see the semantic duplication; it fires later, if at all, when
   new features add function-level complexity.
4. The skill review finds the pricing duplication and the reach-in on both debt targets. On `commerce-monolith` it acts on them and later
   features get cheaper. On `commerce-monolith-elsewhere` it also acts, because its `next-change` rule cannot discriminate in a young
   repository, so it spends effort the backlog never repays.
5. On `commerce-monolith-clean`, every adaptive arm stays close to baseline.

### A simpler health model

The first health score grew into eight hand-weighted rules, several of which fire together on one tangled function, and two later candidates
(module boundary violations and repeated rule tables) only matched the conventions and debt shapes planted in our own targets. The consolidated
model (`app/eval/health-v2.ts`) has two axes and three ingredients, each with an external threshold:

- **Health, how hard a file is to change:** cognitive complexity per function (SonarSource's method; each point above Sonar's default limit of
  15 costs 0.2) and duplication (copies that still match after renaming, at least 50 tokens, jscpd's default, ignoring imports and type
  declarations; each tenth of a file's code lines in a copy costs 1). File health is 10 minus both, floored at 1.
- **Heat, how often it is changed:** the number of the last six features that touched the file.
- **Health where the work is:** file health weighted by size times heat, the codebase summary.

Duplicated knowledge written in different shapes, module boundaries, and naming are deliberately left to review. The current health gates keep
using the first score so that running arms stay comparable.

Offline comparison over 4,175 stored checkpoints rebuilt from patches (`npm run eval:compare-health:local`):

| | First score | Health v2 | Health v2 where the work is |
|---|---:|---:|---:|
| Usage-metering seed with planted copies, versus its consolidated reference | 9.52 vs 9.59 | 8.96 vs 10 | 8.96 vs 10 |
| Commerce debt seed versus clean seed | 9.94 vs 10 | 10 vs 10 | 10 vs 10 |
| Usage metering, inherited score versus next feature's churn, baseline only (415 features) | −0.26 | −0.24 | −0.26 |
| Usage metering, same, all arms (1,938 features) | −0.16 | −0.25 | −0.25 |
| Usage metering, spread of inherited scores within feature (all arms) | 0.61 | 0.70 | 1.03 |
| Inventory and routing, same correlation | −0.15 to 0.07 | −0.09 to 0.07 | −0.11 to 0.07 |

The simpler model predicts at least as well as the first score, separates the planted copy from its fix where the first score could not, and
moves over a wider range where code actually decays. "Health where the work is" is the best headline number: the same predictive strength with
the widest spread. As before, nothing predicts on inventory and routing: agents there never wrote a function above cognitive complexity 12 and
almost no copies, so there was nothing to measure. On usage metering, functions reached 45 and about 9% of the code ended up copied.

Limitations and one change after the first run:

- None of the measures predicts hidden-test failures; failures are rare and follow implementation defects, not structural health.
- Repetitive parallel code (long ladders of near-identical conditions or data lines) reads as copies after normalization, a blind spot shared
  with common clone detectors.
- "Health where the work is" was first weighted by heat alone. A unit test showed that this gives a one-line file as much say as a large one;
  it was changed to size times heat and the comparison rerun. The first run gave −0.20 instead of −0.26 for usage-metering baselines.
- The commerce monolith's planted debt is invisible to every measure, by design; it is the test of whether review catches what metrics cannot.

### A third axis: coupling

Health and heat say nothing about coupling, and the commerce monolith's planted debt is invisible to every health measure because its two
pricing copies are written differently. Change history sees it anyway: in the first two baseline runs of each monolith variant, a feature
changed both `orders` and `billing` in 63% of features on `commerce-monolith`, 25% on the clean seed with the same backlog, and 0% on
`commerce-monolith-elsewhere`, where the same debt sits untouched.

The candidate trigger has the same shape as the hotspot rule: two files in different directories (excluding index and type-only files) that
changed together in at least three of the last four features, with at least four features left. Dry-run on every stored baseline, it fired in 2
of 2 `commerce-monolith` runs, after feature 4, both times on `src/billing/rules.ts` and `src/orders/pricing.ts`, and in 0 of 126 other runs,
including both clean-seed and both elsewhere runs. It cannot fire in single-directory targets, where duplication sits inside one file and
health already sees it: in usage metering, `meter.ts` and `policy.ts` changed together equally often with and without refactoring.

Prediction before the full monolith run completes: across its baseline runs, the coupling trigger fires in most `commerce-monolith` runs, near
feature 4, on the two pricing files, and in almost no clean-seed or elsewhere runs.

The three questions for the talk become: is it hard to change (health), do we change it often (heat), and does changing it drag something else
along (coupling)?

The gate reports a cluster rather than a pair: the largest set of files, spanning at least two directories, that some three of the last four
features all changed. Requiring every member to change in the same features stops a file that changes with everything from chaining unrelated
work together; including index files, for example, would have produced a false cluster in the clean seed (`src/index.ts` with
`src/orders/service.ts`), because the composition root changes whenever a feature adds wiring. In the stored monolith runs the cluster is exactly
the pricing pair.

The `skill-review-coupling-gated` arm uses it: when the gate fires, the skill reviews the last four features as one pull request, starting from
the named files, and decides what to refactor or declines; the gate is then spent. The `coupling` manifest runs it against fresh baselines on
the three monolith variants. Predictions before it runs:

1. On `commerce-monolith` the skill reviews near feature 4 and acts on the pricing duplication, and later pricing features touch fewer files.
2. On the clean seed and on `commerce-monolith-elsewhere` it almost never reviews, so cost and churn match baseline.
3. It reaches the planted debt that the health-gated arm cannot see, at a small fraction of the cost of reviewing every feature.

### Sensors for timing, judgment for targets

Interim results split the decision in two. The gates time a refactor well and stay quiet on healthy code, but they choose no target. The skill
picks excellent targets (the planted duplication, real bugs) but acts on 40–90% of features, so it costs the most and later features got more
expensive, not less. Two combined arms test the split: `skill-review-health-gated` and `skill-review-maturity-gated`. When the arm's gate
opens, the skill reviews that feature once and decides what to refactor or declines; either way the gate is then spent. The `combined` manifest
runs both with fresh baselines on the three original targets, and the `monolith` manifest includes both.

Predictions before any run:

1. On usage metering, both combined arms refactor once near feature 6 or 7, on the duplicated decision paths, and save at least as much downstream
   as their gate alone with no worse correctness.
2. On inventory and routing, neither combined arm reviews anything, so both match baseline: the gate supplies the brake the skill lacks.
3. On the commerce monolith, the health-gated arm rarely reviews because the metric cannot see the debt, while the maturity-gated arm reviews
   around feature 7 and targets the pricing duplication. The metric's blind spot shows up as a missed refactor, not a bad one.
4. Both combined arms cost a fraction of `skill-review`, because they run one review instead of twelve.

## Recommended next experiments

1. Run the health-policy manifest: the revised maturity trigger, the health gate, and the safeguard unchanged on `usage-metering`,
   `inventory-reservations`, and `notification-routing`.
2. Compare against fresh concurrent baselines to reduce time-of-run confounding.
3. Preserve attempted churn as the primary effort measure and hidden correctness as a non-inferiority gate.
4. Run the positive-control ladder to isolate the replay guard, the evidence brief, and the playbook.
5. Add a second positive-control target with a different refactoring mechanism, such as duplicated state transitions rather than duplicated policy
   evaluation.
6. Repeat the positive-control study with another model family.
7. Test whether the playbook generalizes across targets: does a recipe written on one trajectory help a fresh trajectory on the same target?

## Current practical conclusion

The most defensible conclusion is:

> Refactoring was valuable when a repeated concept had matured and enough related work remained, but poorly timed or repeated refactoring was neutral,
> expensive, or actively harmful.

The revised one-shot maturity policy is promising enough for out-of-sample validation, but not yet ready to be treated as a general development rule.

## Series 2: signals decide when and where, the skill decides what

Written before any series 2 run.

### Question and arms

In an outer loop, does "signals decide when and where, the skill decides what" beat no refactoring, the skill reviewing every pull request,
and the signals acting alone? The `series-2` manifest runs four arms on five targets at 10 replicates, 200 trajectories:

| Arm | Scenario | When | What |
|---|---|---|---|
| Baseline | `baseline` | Never | Nothing |
| Skill on every pull request | `skill-review` | Every feature | The skill reviews the feature's diff; the harness applies its first act-now finding |
| Signals only | `signals-only` | The signals gate | A refactorer briefed with what the gate saw makes one bounded refactor, or none if nothing holds up |
| Signals plus skill | `signals-skill` | The signals gate | The skill reviews the last four features as one pull request, starting from the named files, and decides what to do or declines |

Targets: `usage-metering` (copies within a file, which health sees), `commerce-monolith` (one rule written in two modules, which coupling sees),
`commerce-monolith-elsewhere` (the same debt with no future work on it), `commerce-monolith-clean` (nothing should fire), and
`inventory-reservations` (small and healthy).

Every refactor in every arm runs behind the replay guard with key-sorted comparison and behind exported-API protection. `series-2-smoke` runs one
trajectory of each gated arm on usage metering and the monolith before the full series.

### The signals gate

All three signals come from `app/eval/signals.ts` and are recorded at every checkpoint of every arm (`signals` on each iteration):

- **Health** is health v2 per file (`app/eval/health-v2.ts`), unchanged; the brief also names the copied line ranges, which do not enter the score.
- **Heat** is how many of the last six features changed a file; a file is **hot** when three of the last four features changed it.
- **Coupling** is the largest set of production files, spanning two or more directories, that some three of the last four features all changed,
  excluding barrels and type modules.

The gate opens after at least four features, while at least four features remain, when either:

- a hot file is below health 9.5 and is less healthy than at the checkpoint four features earlier (a file created inside the window starts at 10); or
- a coupling cluster exists in the last four features.

It is one-shot in both gated arms: once it has opened a refactor or a review, it stays closed for the rest of the trajectory, even when the skill
declines. The open decision in the handoff, re-arming four features after each review, was resolved toward the safer and already-tested shape.

The brief names each hot file's health then and now, how many recent features changed it, functions above cognitive complexity 15, and copied line
ranges, plus the coupled cluster. It says the signals point to where to look, not what to change.

### Rule change made after earlier runs

Break-even now starts at a trajectory's first intervention spend rather than its first applied refactor, so a review that declined to act counts as
an intervention and its cost is not hidden. This changes stored numbers for arms that review: `skill-review` is now measured from feature 1, and
gated reviews that declined now count. Arms whose intervention phases run only when they act (`refactor-after-*`, the maturity and health gates)
are unchanged.

### Dry run on stored baselines

Before any series 2 run, the gate was replayed over the stored series 1 baselines (`npm run eval:analyze:local`, checkpoints rebuilt from patches).
This tests only where the gate fires, not outcomes:

| Target | Baselines | Fires | After feature | On |
|---|---:|---:|---|---|
| `usage-metering` | 30 | 29 | 4 (10), 5 (19) | `src/meter.ts`, health about 6 down from 6.74, with the copied record and preview lines named |
| `commerce-monolith` | 3 | 3 | 4 | The pricing pair: coupling in all three, and health on both files in one |
| `commerce-monolith-elsewhere` | 4 | 0 | | |
| `commerce-monolith-clean` | 6 | 0 | | |
| `inventory-reservations` | 23 | 6 | 4 or 5 | `src/inventory.ts`, health about 9.2 down from 10 |

Two things differ from series 1. On usage metering, the gate points at `meter.ts`, where the duplication was planted, instead of the first health
gate's `policy.ts`, because health v2 sees renamed copies. It also fires a feature or two earlier than the maturity and first health gates
(feature 6), between the refactor after feature 3 that never paid back and the refactor after feature 6 that did. On inventory it would fire in about
a quarter of runs, on a file that just crossed the bar.

### Predictions

From the handoff, unchanged:

1. Signals plus skill reaches the planted debt in both usage metering and the messy monolith, about once per run, and leaves the elsewhere, clean,
   and inventory targets alone.
2. It matches or beats signals only on later-feature cost, because the skill picks better targets.
3. It costs a fraction of skill on every pull request, at equal or better health.
4. Signals only misses the monolith debt when the gate fires on health, and finds it when the gate fires on coupling.

Added after the dry run:

5. The gate fires after feature 4 or 5 on usage metering and after feature 4 on the monolith, in nearly every run of both gated arms, and never on
   the elsewhere or clean seeds.
6. On inventory it fires in about a quarter of runs. There, signals plus skill mostly declines, while signals only usually refactors something;
   neither changes later-feature cost measurably, so prediction 1's "leaves inventory alone" holds for the skill's decision but not for the gate.
7. Because the gate fires earlier than feature 6 on usage metering, both gated arms save less per later feature there than the stored feature-6
   refactor did, but have more features left to repay it; break-even still falls inside the backlog.
8. No arm loses hidden-test correctness to a refactor: every rollback the guard makes is recorded, and every hidden failure follows an
   implementation phase, not a refactor.
