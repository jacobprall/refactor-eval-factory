---
refactor: parameterize-function
title: Parameterize Function
direction: remove
behavior: preserving
risk: low
smells: [reinvented-logic]
requires: [characterization-test]
---

# Parameterize Function

Merge a family of functions that differ only in a literal value or a field into one function that takes that value as a parameter, then delete the copies. From Fowler's Parameterize Function (ch. 11), known as Parameterize Method in the first edition.

## Use when

- Function names differ by one word that maps to a value: `getActiveUsers` and `getInactiveUsers`, `findByName` and `findByEmail`.
- Bodies are identical apart from a constant, a status string, a threshold or a field name.
- A bug fix landed in one member of the family but not the others.

## Don't use when

- The parameter would be a flag that selects different code paths. That trades duplication for a [Tangled Function](../smells/tangled-function.md); keep separate functions.
- The variants differ in edge behavior (sorting, error handling, defaults) that would need conditionals inside the merged body.
- There are only two copies and they are likely to diverge. Rule of three applies.

## Preconditions

- A [Characterization Test](characterization-test.md) for each variant being merged, if none exists. Use inputs where the variants' literals matter.
- The variants read side by side, with every difference listed. If any difference isn't a value, stop.

## Steps

1. Pick the variant whose body is easiest to generalize.
2. Add a parameter for the varying value with [Change Function Declaration](change-function-declaration.md). Have existing callers pass the literal it used.
3. Change the body to use the parameter instead of the literal. Run the tests.
4. For each other variant, make its body call the parameterized function with its own value. Run the tests.
5. Change callers of each variant to call the parameterized function directly, then delete the variant. Run the tests after each.
6. Give the parameterized function a name that covers the whole family.

## Verify

One function remains, every former variant's tests pass against it, and no caller passes a value that selects a different branch of logic.

## Report as

A structure removal that saves several near-identical functions and the risk of fixing only one. Name the family, the varying value, and the proposed signature. Effort scales with the number of variants and callers.
