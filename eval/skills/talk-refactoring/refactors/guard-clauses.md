---
refactor: guard-clauses
title: Replace Nested Conditional with Guard Clauses
direction: reshape
behavior: preserving
risk: low
smells: [tangled-function]
requires: []
---

# Replace Nested Conditional with Guard Clauses

Turn the unusual and invalid cases that wrap a function's main path into early returns or throws at the top, so the normal case reads unindented from top to bottom. There is no inverse; if the guards themselves pile up, the conditional needs a different shape. From Fowler (ch. 10) and Beck's Guard Clauses tidying (ch. 1).

## Use when

- The main logic sits inside one or more `if` blocks that span most of the function.
- An `else` branch only returns, throws or sets the result, then falls through to a single exit.
- The nesting checks preconditions (missing input, wrong state, nothing to do), not a choice between equal alternatives.

## Don't use when

- The branches are co-equal choices, one per type or mode. That is dispatch, not preconditions; see [Replace Conditional with Polymorphism](replace-conditional-with-polymorphism.md).
- Code after the conditional must run on every path (cleanup, a metric, a shared write) and there's no `finally`, `defer` or context manager to carry it.
- The guard checks a state that can't happen. Delete it, or state it with [Introduce Assertion](introduce-assertion.md), instead of restructuring it.
- So many guards would stack up that the top of the function becomes its own puzzle. Name the combined precondition with [Extract Function](extract-function.md).

## Preconditions

- Tests that reach each branch. Inverting conditions is where mistakes hide, so if a branch is untested, write a [Characterization Test](characterization-test.md) for it first.
- Know what runs after the nested block. Anything every path relies on must still run once each early exit is in place.

## Steps

1. Pick the outermost condition that guards an unusual case.
2. Invert it if needed and turn it into a guard at the top (`if (!user) return null;`), then un-indent the body it wrapped. Return exactly the value the old branch produced; don't improve it in the same step.
3. Run the tests.
4. Repeat for the next condition, one guard per step, running tests after each.
5. If several guards return the same result for the same reason, combine them into one named condition (Fowler's Consolidate Conditional Expression). Leave them separate if the reasons differ.
6. Remove any result variable or flag that only existed to carry a value to the single exit.
7. Run the full test suite.

## Verify

Every input that took an exit path before returns or throws the same thing now. The main path has no more nesting than its own logic needs. Check compound inversions by hand: the negation of `a && b` is `!a || !b`.

## Variants

- **Guard Clauses** (Beck): the same move as a tidying. Beck cautions that a long run of guards is itself hard to read.

## Report as

A behavior-preserving tidying of one function. Name the conditions that become guards and the main path they unbury. Effort scales with the nesting depth and with any shared code after the conditional that each exit must now carry.
