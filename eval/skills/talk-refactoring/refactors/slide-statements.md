---
refactor: slide-statements
title: Slide Statements / Cohesion Order
direction: reshape
behavior: preserving
risk: low
smells: [scattered-knowledge, overloaded-module, reinvented-logic]
requires: []
---

# Slide Statements / Cohesion Order

Move related code next to each other: a declaration next to its first use, the statements that work on one value into one run, the functions in a file that change together side by side. It fixes nothing on its own. It is a cheap preparatory step that makes the next extraction, merge or deletion visible and safe. From Fowler (Slide Statements, ch. 8) and Beck's Cohesion Order and Chunk Statements tidyings (ch. 6, 11).

## Use when

- A follow-up move ([Extract Function](extract-function.md), [Split Phase](split-phase.md), [Extract Class / Module](extract-module.md), [Combine Functions into Class / Transform](combine-functions.md)) is blocked because the lines it needs are interleaved with unrelated ones.
- Functions that change together sit far apart in a file or tree, and the coupling can't be removed yet.
- Two near-duplicate fragments are easier to compare, and later replace, once they sit side by side.
- Every branch of a conditional starts or ends with the same statements.

## Don't use when

- No follow-up move or pending change needs it. A reorder on its own is diff churn; record it as "later" or drop it.
- A statement would cross another that it interferes with: I/O, mutation, an `await`, or anything that can throw. Order is behavior there.
- A team or tooling convention fixes the order (exports first, define-before-use, alphabetical).

## Preconditions

- For each statement you plan to move, what it reads and what it writes. A statement can't cross one that writes what it reads, reads what it writes, or writes the same thing.
- Tests covering the function when the moved statements have side effects. Moving declarations or pure computations needs only the type checker.

## Steps

1. Name the grouping you want and the move it enables.
2. Move one statement, or one function within a file, toward its group.
3. Check the interference rule before each move. Stop if a statement would cross a side effect you can't reason about.
4. Run the tests or the type checker after each move.
5. Put a blank line between finished groups (Chunk Statements) so the next move has visible boundaries.
6. Commit the reorder on its own, before the move it prepares.

## Verify

The diff contains only moved lines; a move-aware diff (`git diff --color-moved`) shows no edits. Tests pass. Each group can be described with one short phrase.

## Variants

- **Cohesion Order** (Beck): the same move at file or directory scale. Put elements that change together next to each other when you can't decouple them yet, so the coupling is at least visible.
- **Chunk Statements** (Beck): insert a blank line between groups of statements that do different things. The smallest step, and often the first one in a chain.
- **Consolidate Duplicate Conditional Fragments** (Fowler, an alias of Slide Statements): move statements repeated in every branch out above or below the conditional.

## Report as

A preparatory, behavior-preserving step. Recommend it together with the move it enables and as a separate commit, never as a finding on its own. Effort is small; the only risk is a statement with a side effect crossing another.
