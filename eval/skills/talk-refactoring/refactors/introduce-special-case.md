---
refactor: introduce-special-case
title: Introduce Special Case
direction: add
behavior: preserving
risk: medium
smells: [swallowed-errors, tangled-function]
requires: [characterization-test]
---

# Introduce Special Case

Replace a special value that many callers check for and handle the same way (usually `null`, `undefined`, `"unknown"` or an empty sentinel) with an object or value that carries the shared handling itself, so the checks disappear from the callers. From Fowler (ch. 10), with Kerievsky's Introduce Null Object (ch. 9) as the do-nothing form. It has no named inverse; if the special case ends up serving a single caller, inline it back.

## Use when

- Three or more call sites test for the same special value and respond the same way (the same default name, the same zero, the same skipped step).
- The special value stands for a legitimate domain case: a guest user, an unknown customer, an account with no plan.
- The repeated guards are what make a function tangled: the core logic is buried under the same `if (x == null)` branches.

## Don't use when

- The special value stands for a failure. Wrapping an error in a friendly object swallows it in a new form; use [Narrow Error Handling](narrow-error-handling.md) instead.
- Callers handle the case differently. A shared object would force one behavior on all of them.
- There are only one or two checks. Added indirection is itself a cost, and this move needs a concrete driver: enough repeated checks that changing the default would otherwise touch many files.
- The codebase already uses one idiom for absence consistently (`Option`, `Maybe`, a documented single default). Follow it rather than adding a class.

## Preconditions

- A [Characterization Test](characterization-test.md) for at least one caller on the special path, recording what it does today when the value is missing.
- Every check found: search for the comparison (`=== null`, `is None`, `== "unknown"`) and the fallback literal, not just the function name.

## Steps

1. Write the characterization test for the special path and run it.
2. Add a check on the subject itself (an `isUnknown` property or function) and replace each raw comparison with it, one caller at a time. Run tests after each.
3. Create the special case: a class, a frozen object literal or a factory function that has the same shape as the real subject, with `isUnknown` true.
4. Change the source (the lookup, the parser, the constructor) to return the special case instead of the raw special value. Run tests.
5. For each caller, move its handling (the default name, the zero total) into the special case and delete the caller's branch. Run tests after each caller.
6. When no caller reads `isUnknown` for behavior any more, remove it, or keep it only where a caller has a real reason to branch.
7. Run the full test suite.

## Verify

The characterization test passes unchanged. A search for the old comparison and fallback literal finds no callers. Nothing that used to surface as an error is now absorbed by the special case.

## Variants

- **Introduce Null Object** (Kerievsky): the special case does nothing (a no-op logger, an empty notifier, a zero discount), so callers can call it unconditionally.
- **Special case as a value**: in functional code, return a constant record, or apply one transform that fills in defaults, instead of defining a class.

## Report as

A behavior-preserving add-structure move. Name the special value, list the duplicated checks it removes, and say why the value is a legitimate case and not a failure. Effort scales with the number of callers; risk rises if any caller relied on the value being null to detect an error.
