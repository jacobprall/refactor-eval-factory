---
card: inconsistent-solutions
title: Inconsistent Solutions
scope: cross
bundle: map
family: duplication
inputs: [code, map, git]
evidence: measured (indirect) + practitioner
also_check: [reinvented-logic, swallowed-errors, dead-code]
refactors: [substitute-algorithm, change-function-declaration, remove-dead-code]
---

# Inconsistent Solutions

One recurring concern is handled several different ways across the codebase: HTTP calls, error reporting, config loading, dates, or the name of a domain concept. Readers can't carry what they learned in one module to the next, and every difference has to be checked for meaning. Agents copy whatever pattern is nearest, so each variant breeds more of itself.

## Signals

Read this section to find candidates. If nothing here matches the code in front of you, skip the rest of the card.

- `inconsistent-solutions.dependency-family`: two or more libraries for the same job in the manifests or imports (HTTP client, dates, logging, validation, ...). Built-in `fetch` and `console` count as members when a library for the same job is also present.
- `inconsistent-solutions.mixed-error-idioms`: a module that both throws and returns error objects.
- `inconsistent-solutions.synonym-terms`: different domain terms for one concept across modules (`user`, `account`, `member`). This comes from the model pass that writes each module's domain terms, so confirm that the terms really name the same thing.

Reading cues with no machine signal:

- One module bypassing a shared helper that its peers use (raw `fetch` beside an API client, direct env reads beside a config module).
- Dates as strings in one module and date objects in the next.
- Callbacks, promises and `async`/`await` mixed within one layer.
- Function names that drift for the same operation (`getUser`, `fetchAccount`, `loadMember`).

## Judgment

### Confirm by

1. Name the concern in a few words and list every mechanism the repo uses for it, with a count of sites for each (search imports and call patterns).
2. Use git to see which mechanism is newer and whether a migration is underway: a deprecation note, a tracking issue, or a steady shift in recent commits.
3. Check whether the differences carry meaning: a different protocol, a different error contract at a system boundary, or different semantics.
4. Choose the target: the dominant local idiom, unless the user or the agent instructions file says otherwise.
5. Quote one representative site of each variant, with the site counts.

### Not a finding

- A migration in progress that someone is tracking. The finding becomes "finish the migration", and it only matters if the migration has stalled.
- Deliberate differences at a boundary: a second client for a different protocol, a streaming use the main client can't do.
- Idioms that look alike but differ in semantics.
- A module that throws internally and converts to result objects at its public edge. That is one translation, not drift.

### Boundaries

- The same computation written twice belongs to [Reinvented Logic](reinvented-logic.md). This card is different mechanisms or conventions for one kind of concern.
- A convention of catching and defaulting everywhere belongs to [Swallowed Errors](swallowed-errors.md); this card only asks whether the idiom is consistent.
- A second library that nothing imports belongs to [Dead Code and Leftovers](dead-code.md).

### Also check

- [Reinvented Logic](reinvented-logic.md): an oddball solution usually hides a duplicate implementation of something the dominant idiom already does.
- [Swallowed Errors](swallowed-errors.md): mixed error idioms often include `null` returns that hide real failures.
- [Dead Code and Leftovers](dead-code.md): once sites converge, the losing library and its wrappers should be removed.

### Refactors

- [Substitute Algorithm](../refactors/substitute-algorithm.md): the default. Converge every site on the chosen idiom (Beck's Normalize Symmetries). For a large spread, use the Unify Interfaces with Adapter variant as a temporary migration path, and remove the adapter when the last site moves.
- [Change Function Declaration](../refactors/change-function-declaration.md): to rename functions, types and fields to the canonical domain term.
- [Remove Dead Code](../refactors/remove-dead-code.md): to delete the losing library, helper or wrapper once nothing uses it.

Not a refactoring, but often the most durable fix: record the chosen convention in the repo's agent instructions file (for example `AGENTS.md` or a Cursor rule), so the next session doesn't reintroduce the variant.

## Evidence

Measured, indirect. In merged Claude Code PRs, 23.4% of later revisions were style fixes and 27.1% were refactoring, and the authors attribute both to the model missing local conventions (Watanabe et al.). Agent refactorings are mostly renames and type changes (Horikawa et al.; Java only). Practitioner: Willison and Pocock report that agents follow whatever patterns are present, so drift compounds where the code is already inconsistent. That separate agent sessions create parallel abstractions for the same concern is a hypothesis.

## Aliases

Oddball Solution (Kerievsky ch. 4), Normalize Symmetries as the target state (Beck, *Tidy First?*), Consistency (Ousterhout ch. 17), convention and idiom drift (agent-code research), the naming-synonym case of Mysterious Name (Fowler ch. 3) and "use names consistently" (Ousterhout ch. 14).
