---
name: refactoring
description: Finds code smells and recommends refactorings in a diff, pull request, or whole codebase, with severity, effort, and the case for and against each change. Tuned for agent-generated code; grounded in Fowler, Ousterhout, Feathers, Kerievsky, Beck, and Meszaros. Use when the user asks about code quality, maintainability, tech debt, refactoring, cleanup, duplicated or dead code, over-engineering, fragile or over-mocked tests, or reviewing a change for design problems rather than bugs.
---

# Refactoring

Inspect a codebase the way you would inspect cheese for mold: say where the mold is, how far it has spread, and how you would cut it out if the user wants it gone. The output is a ranked report of findings with refactoring plans. Changing code is a separate step the user asks for.

## Stance

- **Both directions.** Agent-written code has too much structure as often as too little. Removing a layer, an option or a copy is as valuable a recommendation as extracting one, and often cheaper.
- **Precision over recall.** Scripts and signals only say where to look. A finding needs a quoted code excerpt and your reasoning. A short report of real problems beats a long one the user learns to ignore.
- **Name the cost.** Every finding says which symptom it causes: change amplification (one change needs edits in many places), cognitive load (too much to hold in your head), or unknown unknowns (it isn't obvious what must change).
- **Patterns spread.** Agents copy what is already in the codebase. A smell that appears in many places, or is growing, matters more than a one-off.
- **Respect the code that is fine.** Long, flat code is not tangled. A pattern that replaced a large conditional is not over-engineering. Each card lists what is not a finding; take those lists seriously.

## Scope

- **Pull request or diff:** pass `--diff <base>` (for example `--diff origin/main`) to `profile` and `map`. Signals and work units are limited to changed files and their modules; percentiles still come from the whole repo.
- **Whole repository:** the default.
- **Part of a repository:** run on the whole repo, then keep only the work units and cross-module evidence for the directories the user named.

The steps are the same at every size. Size changes how many work units there are and how deep the map goes, never the order of the steps.

## Pipeline

Copy this checklist and track it:

```
- [ ] 0. Read the project's own rules
- [ ] 1. Profile
- [ ] 2. Map
- [ ] 3. Model pass over map.md
- [ ] 4. Probes (ask first)
- [ ] 5. Local scan, one work unit at a time or in parallel
- [ ] 6. Cross-module scan, one family at a time or in parallel
- [ ] 7. Reduce
- [ ] 8. Score
- [ ] 9. Report
```

All files go in `.refactor/` at the repository root. Each step reads only the files earlier steps wrote, so a run can resume from any step and parallel work merges cleanly. Formats are in [references/formats.md](references/formats.md).

### 0. Read the project's own rules

Read the repository's agent instructions (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`) and its architecture docs before scanning. Documented module responsibilities, import-direction rules and conventions are constraints, not smells. A finding that contradicts a documented decision goes to the report's Questions section, and no plan may break a documented rule.

### 1. Profile

```bash
python3 <skill-dir>/scripts/recon.py profile --root <repo> [--diff <base>]
```

Read the printed summary. It gives size, pace of change, tests, tooling, dependency families, hotspots, the cross-module cards with their strength, and every work unit with its modules and the cards it should load. Open `.refactor/profile.json` to look up a module's signal examples (up to eight per signal; search the code for the rest).

### 2. Map

```bash
python3 <skill-dir>/scripts/recon.py map --root <repo> [--diff <base>]
```

Run it for whole-repo scope, and for a diff that touches two or more modules. Skip it for a diff inside one module. It writes `map.json` (imports, exports, interface depth, cycles, hubs, unused and test-only exports, one-implementation abstractions) and `map.md`, the skeleton for step 3.

### 3. Model pass over map.md

Open `.refactor/map.md`. For every module whose `responsibility` line is empty, write:

- `responsibility:` one line on what the module is for, written from its exports and doc lines only. Don't open source files for this.
- `terms:` the domain nouns it owns, comma-separated.

Modules marked "no exports" (entry points, servers, scripts) get a responsibility written from their file names, imports and entry files. Test modules are filled in already.

If a responsibility needs "and", or can only be generic ("utilities", "helpers"), leave it that way: that is evidence for [Overloaded Module](smells/overloaded-module.md). Lines whose hash hasn't changed are kept on the next run, so this pass only covers new or changed modules. Write the lines in one batch edit rather than one module at a time; for more than about 40 modules, split them across subagents.

Then compare across modules. Two responsibilities that describe the same job are `reinvented-logic.similar-responsibility` leads. Different terms for one concept (`user`, `account`, `member`) are `inconsistent-solutions.synonym-terms` leads. While reading exports, note any whose doc line describes I/O, cancellation, an ownership check or a state change that its name doesn't suggest: those are `misleading-interface.name-doc-mismatch` leads. Write all three as lead records to `.refactor/candidates/map-pass.jsonl` (format in [references/formats.md](references/formats.md)); the duplication family reads them in step 6.

### 4. Probes

Probes run the project's own tests, type checker and linter. They are the most precise signals available (unused-symbol warnings, the stub-the-body check), but they install dependencies, take time and can have side effects. Ask the user before running them, unless the user or the system running you has said the environment is disposable (for example, a sandbox created for this run). A local clone is not disposable on its own: installs and tests can still reach the network and shared services. Follow [references/probes.md](references/probes.md). Without probes, the run still works; say in the report that it was static only.

### 5. Local scan

For each work unit in the profile summary:

1. Read each card listed in its `cards_by_bundle` once. Cards are short. Use the **Signals** section while reading code, and the **Judgment** section only when something matches.
2. Read the unit's files, starting with the files named in signal examples and hotspots. For size class L or XL, read flagged files and hotspots rather than every file. Modules listed as "also read, no signals" have no machine signals; read them once with the same cards in mind. Seams between modules (one module consuming another's result) are where signals help least and reading helps most.
3. Read one bundle at a time: test files once for all test cards, source files once for all source cards, then judge each module as a whole for module cards.
4. When something matches a card's signals or reading cues, read that card's **Judgment** section and follow its Confirm by steps. Record a candidate only after confirming, with the quoted excerpt.
5. When a candidate confirms, follow the card's **Also check** links and apply those cards to the same files, up to two extra cards per unit.
6. Write candidates to `.refactor/candidates/<unit-id>.jsonl`.

With more than one work unit, run units as parallel subagents. Give each one this brief, filled in:

```
You are scanning one work unit for code smells, using the refactoring skill at <skill-dir>.
Repo: <repo>. Unit: <unit-id>, modules: <modules>.
Cards to load, by bundle: <cards_by_bundle>. Deferred cards (load only if a confirmed candidate links to them): <deferred>.
Signals for these modules are in <repo>/.refactor/profile.json under modules[].signals.
Read each card's Signals section first and its Judgment section only for real candidates.
A candidate needs a quoted excerpt and reasoning; signals alone are never findings.
Write candidates to <repo>/.refactor/candidates/<unit-id>.jsonl in the format in <skill-dir>/references/formats.md.
Reply with the number of candidates per card and any card you dismissed after checking, with one line on why.
```

### 6. Cross-module scan

Cross-module cards run once per family over the whole map, not per work unit:

| Family | Cards | Main evidence |
|---|---|---|
| Duplication | [Reinvented Logic](smells/reinvented-logic.md), [Inconsistent Solutions](smells/inconsistent-solutions.md), [Scattered Knowledge](smells/scattered-knowledge.md) | map.md responsibilities and terms, duplicate names, dependency families, co-change pairs, repeated literals |
| Abstraction | [Shallow Modules](smells/shallow-modules.md), [Speculative Generality](smells/speculative-generality.md), [Misleading Interface](smells/misleading-interface.md) | interface depth, pass-throughs, one-implementation abstractions, test-only exports, the most-imported exports, name-doc leads |
| Graph | [Import Tangle](smells/import-tangle.md), [Dead Code and Leftovers](smells/dead-code.md) | cycles, hubs, unimported exports, orphan files, unused-symbol probe output |

The abstraction family also runs the **call-site test** from [Misleading Interface](smells/misleading-interface.md), because most interface problems have no machine signal. Take the map summary's most-imported exports, the public entry of each module the project's docs point extension authors at, and any name-doc leads, up to about 25 symbols. For each, predict its behavior from the signature, doc line and one call site, then read the body and record what a caller would get wrong. Group the results by class or module: a coherent rename of one surface is one finding, not one per method.

In repo scope, run all three families. In diff scope, run a family when the profile shows strength above zero for any of its cards, the map summary's "map evidence by family" line counts evidence for it, or the model pass wrote leads for it. Start from `profile.json`, `map.json` and the leads, open code only to confirm, and write candidates to `.refactor/candidates/<family>.jsonl`. Git history is evidence too: a commit that fixed a bug in one copy of duplicated code often left the other copy broken. Families can run as parallel subagents with the same brief as step 5, naming the family's cards and evidence instead of a unit.

### 7. Reduce

1. Drop any candidate without a quoted excerpt.
2. Merge candidates that point at the same symbol or overlapping lines into one finding. Pick the primary smell with the cards' **Boundaries** sections; the others become secondary tags.
3. Merge findings that share one fix (several duplicate helpers that one Replace with Existing Function resolves) into one finding with several sites.
4. Check `.refactor/ledger.jsonl`. Drop findings whose fingerprint was rejected before, unless the code at that site has changed substantially since. Keep accepted-but-not-done findings and say so.

### 8. Score

Score each finding with [references/scoring.md](references/scoring.md): severity, spread, confidence, effort, when, and risk. Order the plan of refactor cards for each finding: safety step first, then structure, then behavior changes.

Check each plan against how the project tests and builds before recommending it. A replacement the test setup can't control (a standard-library timer under fake timers, a module the tests mock by path) or a shared helper the import rules forbid is not a plan. Say what blocks it instead.

### 9. Report

Write `.refactor/findings.json` and `.refactor/report.md` with the template in [references/report.md](references/report.md). In chat, give the headline and the top findings; point to the report for the rest.

## Applying a recommendation

Only when the user asks, and one finding at a time:

1. Read the refactor cards in the finding's plan, including everything in their `requires` field.
2. Write the characterization test first when the code isn't covered ([Characterization Test](refactors/characterization-test.md)).
3. Keep structure and behavior changes in separate commits. Moves labeled `changes-failure-paths` or `changes-behavior` get their own commit and a note in the message.
4. Take small steps and run the tests after each one. If a step breaks tests, undo it rather than patching forward.
5. Record the outcome in `.refactor/ledger.jsonl`: accepted and done, rejected with the user's reason, or deferred.

## Smell cards

| Card | Scope | Problem |
|---|---|---|
| [Reinvented Logic](smells/reinvented-logic.md) | cross | Code re-implements what the codebase or a dependency already does |
| [Inconsistent Solutions](smells/inconsistent-solutions.md) | cross | One kind of concern handled several different ways |
| [Scattered Knowledge](smells/scattered-knowledge.md) | cross | One decision encoded in many modules |
| [Overloaded Module](smells/overloaded-module.md) | local | A module with several unrelated jobs |
| [Tangled Function](smells/tangled-function.md) | local | A function mixing jobs with deep nesting |
| [Shallow Modules](smells/shallow-modules.md) | cross | Layers whose interface costs as much as what they hide |
| [Speculative Generality](smells/speculative-generality.md) | cross | Flexibility for needs that don't exist |
| [Misleading Interface](smells/misleading-interface.md) | cross | Names and signatures that hide behavior a caller must know |
| [Dead Code and Leftovers](smells/dead-code.md) | cross | Code, files and flags nothing uses |
| [Swallowed Errors](smells/swallowed-errors.md) | local | Failures turned into wrong values or silence |
| [Hardwired Dependencies](smells/hardwired-dependencies.md) | local | Code that builds or reaches for its own collaborators |
| [Import Tangle](smells/import-tangle.md) | cross | Import cycles, hubs and reach-ins between modules |
| [Toothless Tests](smells/toothless-tests.md) | local | Tests that pass whether or not the code works |
| [Implementation-Coupled Tests](smells/implementation-coupled-tests.md) | local | Tests that check how, not what |
| [Bloated Test Setup](smells/bloated-test-setup.md) | local | Setup that buries the inputs that matter (severity capped at low) |
| [Narrating Comments](smells/narrating-comments.md) | local | Comments that restate code or narrate edits (severity capped at low) |

## Refactor cards

- **Remove structure:** [Inline Function](refactors/inline-function.md), [Inline Class](refactors/inline-class.md), [Remove Middle Man](refactors/remove-middle-man.md), [Inline Singleton](refactors/inline-singleton.md), [Remove Dead Code](refactors/remove-dead-code.md), [Parameterize Function](refactors/parameterize-function.md), [Replace with Existing Function](refactors/replace-with-existing-function.md), [Narrow Error Handling](refactors/narrow-error-handling.md), [Delete Redundant Comments](refactors/delete-redundant-comments.md)
- **Reshape:** [Change Function Declaration](refactors/change-function-declaration.md), [Move Function / Move Field](refactors/move-function.md), [Substitute Algorithm](refactors/substitute-algorithm.md), [Guard Clauses](refactors/guard-clauses.md), [Slide Statements](refactors/slide-statements.md), [Separate Query from Modifier](refactors/separate-query-from-modifier.md), [Introduce Assertion](refactors/introduce-assertion.md)
- **Add structure:** [Extract Function](refactors/extract-function.md), [Split Phase](refactors/split-phase.md), [Extract Class / Module](refactors/extract-module.md), [Combine Functions](refactors/combine-functions.md), [Replace Primitive with Object](refactors/replace-primitive-with-object.md), [Replace Conditional with Polymorphism](refactors/replace-conditional-with-polymorphism.md), [Replace Magic Literal](refactors/replace-magic-literal.md), [Introduce Special Case](refactors/introduce-special-case.md), [Inject Dependency](refactors/inject-dependency.md), [Wrap Third-Party API](refactors/wrap-third-party-api.md), [Extract Interface](refactors/extract-interface.md), [Encapsulate Variable](refactors/encapsulate-variable.md), [Humble Object](refactors/humble-object.md), [Sprout Method / Class](refactors/sprout.md)
- **Test code:** [Replace Mock with Fake](refactors/replace-mock-with-fake.md), [Assert on Observable Outcome](refactors/assert-on-outcome.md), [Extract Test Helper](refactors/extract-test-helper.md), [Parameterized Test](refactors/parameterized-test.md)
- **Safety:** [Characterization Test](refactors/characterization-test.md)

## Scripts

- `scripts/recon.py profile`: read-only project profile and routing. Seconds, even on large repos.
- `scripts/recon.py map`: module map and map signals.
- `scripts/recon.py check`: validates `signals.json` against the cards. Run it after editing any card or signal.
- `scripts/signals.json`: every machine signal, keyed `<card>.<signal>`. Cards document the keys they own.

Execute the scripts; don't read them. Python 3.8 or later, standard library only.
