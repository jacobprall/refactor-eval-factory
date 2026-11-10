---
refactor: replace-with-existing-function
title: Replace with Existing Function
direction: remove
behavior: preserving
risk: medium
smells: [reinvented-logic]
requires: [characterization-test]
---

# Replace with Existing Function

Replace hand-written code that duplicates a function the project, a dependency or the standard library already provides with a call to that function, then delete the copy. From Fowler's Replace Inline Code with Function Call (ch. 8); it is also the remedy for Mäntylä's "solution approach" findings, where the code takes the wrong approach rather than the wrong arrangement.

## Use when

- New code re-implements a helper that already exists under another name (`formatDate` beside `toDisplayDate`, a second retry loop, a second config loader).
- A loop or block hand-rolls what the standard library does: grouping, deduplication, path joining, date arithmetic, URL parsing.
- A dependency already in the lockfile covers the behavior.

## Don't use when

- The two differ in edge semantics and the difference is deliberate. Record which one is right instead.
- The existing function lives across a service or bounded-context boundary where sharing would create unwanted coupling.
- The replacement would add a new dependency only for this. Weigh that cost explicitly.

## Preconditions

- The canonical function named, with its module and signature.
- Edge semantics compared before swapping. Check at least: rounding and precision, time zones and locale, error behavior (throws, returns null, returns a default), null and empty input, ordering and stability, mutation of arguments.
- A [Characterization Test](characterization-test.md) around the copy being retired, if none exists. Ideally, a quick comparison test that runs both implementations on the same inputs, including the edge cases above.

## Steps

1. Write the comparison test and run it. If any case differs, stop and decide whether the difference is a bug in the copy or a real requirement.
2. Replace one call site of the copy (or the inline block) with a call to the existing function. Run the tests.
3. Repeat for each call site, testing after each.
4. Delete the copy with [Remove Dead Code](remove-dead-code.md). Delete the comparison test or keep its edge cases as tests of the canonical function.

## Verify

The comparison test showed matching results on the edge cases, the copy is gone, and the tests pass unchanged. If a difference was found, the report names it and the chosen behavior.

## Variants

- **Inline block**: the duplicate is a few lines inside a larger function rather than a function of its own. Replace the block with the call in place.
- **Standard library or dependency**: the canonical function is outside the project. Pin the semantics with the comparison test, since library behavior is less visible than local code.

## Report as

A structure removal that saves a second implementation to keep in sync. Name both implementations and the edge semantics checked. Medium risk, because look-alikes that differ in edge behavior are the most dangerous case; if any difference was found, label the change as a behavior change. Effort scales with the number of call sites.
