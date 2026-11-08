---
card: dead-code
title: Dead Code and Leftovers
scope: cross
bundle: map
family: graph
inputs: [code, map, git]
evidence: measured* (no baseline) + practitioner
also_check: [reinvented-logic, speculative-generality, inconsistent-solutions]
refactors: [remove-dead-code, change-function-declaration, substitute-algorithm, characterization-test]
---

# Dead Code and Leftovers

Code, parameters, files and flags that nothing uses: superseded old paths kept next to their replacements, scratch scripts and versioned copies left over from earlier attempts, and commented-out blocks. Readers still have to understand them, and agents copy them as if they were live.

## Signals

Read this section to find candidates. If nothing here matches the code in front of you, skip the rest of the card.

- `dead-code.unused-warning`: a compiler, type checker or linter reports an unused symbol, import, parameter or unreachable branch. This is a probe: it comes from running the project's own tools, only when the user allows it. It is the highest-precision signal on this card.
- `dead-code.unimported-export`: an export with no importers, from the module map.
- `dead-code.orphan-file`: a file with no inbound imports that is not a known entry point, from the module map.
- `dead-code.versioned-file`: `_v2`, `_old`, `_backup`, `.bak` or `-copy` files, and `old/` or `deprecated/` folders.
- `dead-code.stray-root-script`: a source file at the repo root that isn't a known entry point or config file. Often a one-off debugging script from a session.
- `dead-code.commented-out-code`: comment lines that read as code, three or more in a file.

Reading cues with no machine signal:

- A feature flag or config switch that is always on or always off.
- An old and a new implementation of the same thing, both present, where only one has callers.
- A parameter that every implementation ignores, or a branch whose condition the types rule out.
- A "legacy", "fallback" or "temporary" path whose reason no longer applies.

## Judgment

### Confirm by

1. Search the whole repo for the symbol's name, not just the import graph. Include string occurrences: dynamic imports, `getattr`, registries keyed by name, and config files.
2. Rule out every way the code can be reached without a static import: entry points (`main`, `bin` and `scripts` in `package.json`, `console_scripts`, `__main__`), framework routes and file-based routing, CLI commands, migrations, handlers named in config (serverless, cron, queue workers), DI containers and plugin registration, decorators that register on import, and reflection.
3. Check whether the symbol is public API. If the package is published or other repos consume it, having no importers inside this repo proves nothing.
4. For versioned files and old paths, use git to see which copy is newer and whether the older one changed after the newer one appeared.
5. Quote the unused definition and say where you searched for callers.

### Not a finding

- Exports of a published library, or of a module that other services import.
- Code reached by reflection, string lookup, plugin registries or framework convention (Next.js `pages/`, Django URL targets, pytest fixtures in `conftest.py`).
- Shared test utilities imported only by tests. Those are live.
- Parameters required by a callback or interface signature that this implementation happens to ignore. Prefix them with `_` instead.
- Commented-out code with a dated reason and a tracked issue. Low priority at most.
- Generated or vendored code.

### Boundaries

- An abstraction with one implementation, or an export used only by tests, belongs to [Speculative Generality](speculative-generality.md). It is used, just not needed.
- Two live implementations of the same behavior, both with callers, belong to [Reinvented Logic](reinvented-logic.md). Only a copy with no callers is dead code.
- A skipped or commented-out test belongs to [Toothless Tests](toothless-tests.md).

### Also check

- [Reinvented Logic](reinvented-logic.md): a dead old path usually means a new one was written beside it instead of editing it, so the new module may duplicate other live code too.
- [Speculative Generality](speculative-generality.md): unused options and extension points tend to sit next to unused code from the same session.
- [Inconsistent Solutions](inconsistent-solutions.md): an old path that still has a few callers is an unfinished migration, not dead code.

### Refactors

- [Remove Dead Code](../refactors/remove-dead-code.md): the default. Delete it; version control keeps it. When confidence is partial, delete in small commits that can each be reverted alone. Also covers unused classes and empty hierarchy levels.
- [Change Function Declaration](../refactors/change-function-declaration.md): to drop an unused parameter and update every caller.
- [Substitute Algorithm](../refactors/substitute-algorithm.md): when the old path still has a few callers. Move them to the new path, then delete the old one.
- [Characterization Test](../refactors/characterization-test.md): before retiring an old path that still has callers and no tests. Not needed for code with no callers.

## Evidence

Measured, no human baseline: unused function parameters (SonarQube S1172) were the third most-violated rule in 1,210 merged agent bug-fix PRs (Cynthia et al.). In Sonar's benchmark of model output on fixed Java tasks, dead, unused or redundant code is a large smell category, and the largest one for some models (GPT-4o, Llama, OpenCoder) but not for Claude Sonnet 4 or 3.7. Practitioner: Anthropic notes its models sometimes leave temporary scratch files, and Willison names unnecessary, never-used code as a core agent risk. Versioned leftovers (`_v2`, `_old`, `.bak`) are a hypothesis; nothing measures them.

## Aliases

Dead Code (Mäntylä; refactoring.guru), the target of Remove Dead Code (Fowler ch. 8), the Dead Code tidying (Beck ch. 2), Delete Unused Code (Feathers ch. 16), Unutilized Abstraction (Suryanarayana et al.) for unused classes, Lava Flow (AntiPatterns), dead code and leftovers (agent-code research).
