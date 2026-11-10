---
card: import-tangle
title: Import Tangle
scope: cross
bundle: map
family: graph
inputs: [code, map, git]
evidence: hypothesis (agent) + measured (non-agent cost)
also_check: [overloaded-module, scattered-knowledge, shallow-modules]
refactors: [move-function, extract-module, extract-interface, inline-class]
---

# Import Tangle

The module import graph has cycles, hubs, or reach-ins to another module's internals. Modules in a cycle can't be understood, tested or changed on their own, and a change to a hub ripples everywhere. None of this is visible from any single file.

## Signals

Read this section to find candidates. If nothing here matches the code in front of you, skip the rest of the card.

- `import-tangle.cycle`: an import cycle that crosses module boundaries, from the module map. The strongest signal on this card.
- `import-tangle.hub`: a module whose fan-in and fan-out are both high for this repo, from the module map.
- `import-tangle.private-reach`: an import of another module's private or internal members (`_helpers`, `internal/`, `from x import _name`).
- `import-tangle.deep-relative-import`: an import that climbs three or more directories (`../../../`). Usually one module reaching across the tree instead of through another's public entry point.

Reading cues with no machine signal:

- Two modules that import each other directly.
- A function-level or deferred import added to dodge a circular-import error.
- A `utils` or `common` module that imports from feature modules.
- A barrel file (`index.ts`, `__init__.py`) that re-exports from modules which themselves import the barrel.
- A dependency on a module that changes far more often than the importer (git). Useful for ranking only.

## Judgment

### Confirm by

1. Rank before reading. Order cycles by how many module boundaries they cross, then by size (number of files), and read only the top few. Arcan reported 636 class-level cycles in a single project; unranked output is noise. Cycles inside one module are low priority.
2. For each cycle, find the edge that shouldn't exist: usually the import pointing from the more general, more stable module to the more specific one (a shared library importing a feature, a domain module importing a route handler).
3. In TypeScript, check whether that edge is type-only: `import type`, or an import used only in type positions, which the compiler erases unless `verbatimModuleSyntax` is on. Type-only imports create no runtime cycle. They still couple the modules, but rank them low.
4. In Python, check whether the cycle has already forced a deferred import inside a function. That is the cost made visible.
5. For a hub, read its one-line responsibility in the map. A hub with one coherent job (shared types, a logger) is fine; a hub whose description needs "and" is the finding.
6. Quote the import lines that close the cycle, with their file paths.

### Not a finding

- Type-only import cycles in TypeScript. Mention them at low priority only if they block a planned split.
- Composition roots and app entry points, which import everything by design.
- Interfaces, shared type modules and a project-wide logger acting as hubs: high fan-in is their job. Flag a hub only when its fan-out is high too.
- Small cycles formed by factory methods on base types or by nested and inner classes (Arcan's manual validation found these benign).
- Cycles among one module's own files, unless they are large.

### Boundaries

- A hub that is large and does several unrelated jobs is also an [Overloaded Module](overloaded-module.md). This card owns the graph shape; that card owns the split.
- Two modules that keep changing together *without* importing each other belong to [Scattered Knowledge](scattered-knowledge.md).
- An unused import that closes a cycle is [Dead Code and Leftovers](dead-code.md). Delete it first and re-check.

### Also check

- [Overloaded Module](overloaded-module.md): hubs are usually overloaded modules seen from outside.
- [Scattered Knowledge](scattered-knowledge.md): a cycle often means one concept is split across the two modules, and each needs the other's half.
- [Shallow Modules](shallow-modules.md): reach-ins to private members suggest the owning module's interface doesn't offer what callers need, or exports too much.

### Refactors

- [Move Function](../refactors/move-function.md): the default when one or two functions close the cycle. Move them, or a field or constant, to the module that owns the concept, so the edge disappears.
- [Extract Module](../refactors/extract-module.md): when both modules depend on a shared piece. Move it into a new module that both import.
- [Extract Interface](../refactors/extract-interface.md): dependency inversion, when the general module really must call back into the specific one. Define the interface on the general side and let the specific module implement it. In TypeScript and Python a callback parameter or a `Protocol` is often enough.
- [Inline Class](../refactors/inline-class.md): when two modules in a tight cycle are really one concept. Merge them.

## Evidence

Hypothesis for agents: that agents add imports wherever a needed symbol lives, with no view of layering, is reasoning only. The non-agent cost is measured: across nine Apache projects and one commercial system, files in hotspot patterns were more bug- and change-prone than average, and cross-module cycles were among the patterns that contributed most (Mo et al.). DORA 2025, a survey, frames AI as an amplifier that helps loosely coupled architectures and not tightly coupled ones. Scoring gives this card no agent-prevalence bonus.

## Aliases

Cyclic Dependency, Hub-Like Dependency and Unstable Dependency (Arcan), Cross-Module Cycle and Cross-Package Cycle (Mo et al. hotspot patterns), Cyclically-dependent Modularization and Hub-like Modularization (Suryanarayana et al.), Insider Trading, formerly Inappropriate Intimacy (Fowler ch. 3), Dense Structure (Designite), Dependency Tangle (former working name). The rule being broken is Martin's Acyclic Dependencies Principle.
