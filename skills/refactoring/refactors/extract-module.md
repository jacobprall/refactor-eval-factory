---
refactor: extract-module
title: Extract Class / Module
direction: add
behavior: preserving
risk: medium
smells: [overloaded-module, scattered-knowledge, import-tangle]
requires: [characterization-test]
---

# Extract Class / Module

Move a coherent subset of a class's or module's fields and functions into a new class or module, so each one hides one body of knowledge. The inverse is [Inline Class](inline-class.md). From Fowler (Extract Class, ch. 7), with Feathers' feature sketch (ch. 20) to find the split and Ousterhout's "design it twice" (ch. 11) to choose between splits. A new module adds an interface, imports and a place to look, and added indirection is itself a cost (Beck, ch. 31; Kerievsky, ch. 1). The move needs a concrete driver: parts that change for different reasons, knowledge that needs one owner, or an import cycle the split would break.

## Use when

- One module changes for unrelated reasons, and its functions fall into clusters that change separately.
- A subset of fields and functions is used together and barely touches the rest.
- Knowledge about one concept (a format, a policy) is spread through a module that mostly does other things, and pulling it out gives it a single owner.
- A grab-bag module (`utils`, `helpers`, `common`) is in an import cycle, or is imported everywhere, because of one part of it.

## Don't use when

- The module is large because its concept is large, and its functions share its data. Big and cohesive isn't overloaded.
- The new module would be shallow: an interface nearly as large as its implementation, or a class that only forwards. That creates [Shallow Modules](../smells/shallow-modules.md).
- The new module's purpose can't be described without "and". The split is in the wrong place.
- Nothing distinguishes the parts: no pending change, no separate co-change history, no cycle.

## Preconditions

- A [Characterization Test](characterization-test.md) of the module's public behavior.
- Every importer found (the map's importers, then a search), since import paths will change.

## Steps

1. Draw a feature sketch: list each function and field, and for each function the fields and functions it uses. Clusters with few links between them are candidate modules.
2. If the split creates more than one new module, design it twice: write down two different candidate splits and compare the interfaces each creates (exported names, values crossing the boundary). Choose the one with the smaller interface for what it hides.
3. Write the new module's interface comment. If it can't be short, go back to step 1.
4. Create the new module. Move one field at a time, then one function at a time ([Move Function](move-function.md)), running tests after each. Leave the original's public functions delegating for now.
5. Point importers at the new module directly, a few at a time, testing after each.
6. Delete the delegating stubs once nothing calls them.
7. Check the import graph for new cycles, then run the full test suite.

## Verify

Tests pass. The new module exports far fewer names than it contains. The moved concept no longer appears in the original, the import graph has no new cycle, and each module can be described in one sentence.

## Variants

- **Feature Sketch** (Feathers): the function-to-field diagram in step 1, which finds the split from usage rather than from names. It can be computed from the code and quoted as evidence.

## Report as

A behavior-preserving change across files. Name the clusters the feature sketch found, the driver, and for larger splits the two candidates compared and their interface sizes. Effort scales with the number of importers. Mark it high risk if the module is a public API or its import path is published.
