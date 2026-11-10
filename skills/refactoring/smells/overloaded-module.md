---
card: overloaded-module
title: Overloaded Module
scope: local
bundle: module
inputs: [code, map, git]
evidence: hypothesis
also_check: [tangled-function, import-tangle, shallow-modules]
refactors: [sprout, extract-module, split-phase, move-function, slide-statements]
---

# Overloaded Module

A file, class or module serves several unrelated responsibilities. Unrelated changes collide in it, and nobody can state its job in one sentence. Agents add code wherever they are already working, so these modules tend to keep growing.

## Signals

Read this section to find candidates. If nothing here matches the code in front of you, skip the rest of the card.

- `overloaded-module.large-file`: a source file in this repo's top 5% by size (and at least 150 lines). The cut is relative to the repo, never a fixed line count.
- `overloaded-module.many-exports`: a file that exports far more symbols than most files in this repo.
- `overloaded-module.hotspot`: a large file that also changes often (commits times lines), from git history.
- `overloaded-module.generic-name`: a file named `utils`, `helpers`, `common`, `shared`, `manager`, `core` or `misc`.

Reading cues with no machine signal:

- The module's one-line responsibility in the map needs an "and", or is generic.
- Functions that cluster into groups using disjoint fields, imports or helpers.
- A shared utility carrying branches or flag parameters that serve one particular caller.
- A function that mostly works on another module's data. A hint only, never a finding on its own.

## Judgment

### Confirm by

1. Read the module's map entry and try to state its job in one sentence without "and". If you can, the module is probably cohesive whatever its size.
2. Sketch the clusters: for each exported function, note which fields, imports and helpers it uses. Groups that share nothing are candidate modules (Feathers' feature sketch).
3. With git, check whether the file shows up in commits for unrelated features. That is the cost: unrelated work colliding in one place.
4. Design it twice: sketch two different splits and compare their interfaces. Prefer the one where each new module has a small interface and a name that needs no "and". If neither beats the current shape, don't recommend a split.
5. Quote the responsibility line and one function from each of two unrelated clusters.

### Not a finding

- Composition roots and wiring files.
- Large but cohesive modules: algorithms, parsers, schemas, state machines.
- Generated code.
- Facades that are large by design because they are a package's public surface.
- A file in the top 5% that passes the one-sentence test. Size alone is not the smell.
- A small `utils` holding a few closely related helpers.

### Boundaries

- One long, branchy function inside the module belongs to [Tangled Function](tangled-function.md). This card judges the module as a whole.
- A grab-bag module that sits at the center of the import graph with high fan-in and fan-out belongs to [Import Tangle](import-tangle.md) for the graph side.
- Exports that nothing imports belong to [Dead Code and Leftovers](dead-code.md).
- One decision spread across many modules is the opposite problem and belongs to [Scattered Knowledge](scattered-knowledge.md).

### Also check

- [Tangled Function](tangled-function.md): the largest files usually hold the largest functions, and splitting the module is easier after those are untangled.
- [Import Tangle](import-tangle.md): a generic `utils` or `core` module tends to become a hub that everything imports.
- [Shallow Modules](shallow-modules.md): a proposed split must not produce pass-through fragments.

### Refactors

- [Sprout](../refactors/sprout.md): when a change is pending and a full split isn't affordable now. Put the new behavior in a new function or module so the overloaded one stops growing.
- [Extract Module](../refactors/extract-module.md): the default when the clusters are clear. Move one cluster with its data into a module named for its single job.
- [Split Phase](../refactors/split-phase.md): when the module mixes sequential stages, such as parsing and then processing.
- [Move Function](../refactors/move-function.md): when a cluster already belongs to an existing module. Also use it to push caller-specific special cases out of a shared utility and up into the caller.
- [Slide Statements](../refactors/slide-statements.md): a cheap first step that groups related functions together before any split.

## Evidence

Hypothesis. Every source reasons that agents add code wherever they are already working, but no study measures module-level growth. Adjacent measurements: function-level complexity rises causally after agent adoption (see [Tangled Function](tangled-function.md)), and 39.9% of agent PRs are multi-purpose against 12.2% of human PRs (Watanabe et al.; 213-PR subset), which is consistent with unrelated changes landing in the same places.

## Aliases

Large Class and Divergent Change (Fowler ch. 3), God Class and Brain Class (Lanza & Marinescu), Big Class (Feathers ch. 20), Multifaceted Abstraction and Insufficient Modularization (Suryanarayana), God Component and Feature Concentration (Arcan; Designite), Special-General Mixture (Ousterhout ch. 9), with Hard to Pick Name and Hard to Describe as signals (Ousterhout ch. 14-15). The principle behind it is Cohesion (Beck, *Tidy First?*).
