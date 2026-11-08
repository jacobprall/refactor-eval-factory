---
refactor: parameterized-test
title: Parameterized Test
direction: test
behavior: preserving
risk: low
smells: [bloated-test-setup]
requires: []
---

# Parameterized Test

Collapse several tests that run the same steps on different inputs into one test driven by a table of cases, each reported separately. From Meszaros (xUnit Test Patterns, ch. 24). In practice this is pytest's `parametrize`, Jest and Vitest's `test.each`, or Go's table-driven tests; Willison names parametrize as one of the fixes for the duplicated setup he sees most in agent-written Python tests. Changes test code only. The inverse is to split a case back out when it needs its own setup.

## Use when

- Three or more tests are copies that differ only in their input and expected value.
- A test loops over cases inside its body, so the first failure hides the rest and the report doesn't say which case failed.
- Edge cases for one function (empty, single item, boundary, invalid) are spread across copy-pasted tests.

## Don't use when

- Cases need different setup or different assertions. Forcing them into one table adds flags and branches to the test body; keep them separate or group them by shape.
- The table would need a column that says what to check. That is two tests.
- There are only two cases and they read clearly as separate tests.

## Preconditions

- The copies pass today.
- The framework's parameterization feature, and the convention the repo already uses for it.

## Steps

1. Compare the copies to find what varies (inputs, expected values) and what is shared (the steps).
2. Write one parameterized test containing the shared steps, with one table row per original test. Give each row a name that describes the case (`ids=` in pytest, a `$name` or `%s` placeholder in `test.each`).
3. Run it and confirm the number of reported cases equals the number of tests it replaces.
4. Delete the originals.
5. Break one row's expected value on purpose and confirm that only that case fails, under a readable name. Revert.
6. Run the full suite.

## Verify

Every original input and expectation appears as a row. Each row is reported as its own case. The test body has no branches on row contents.

## Variants

- **pytest parametrize**: `@pytest.mark.parametrize("raw, expected", [...], ids=[...])` on one test function.
- **test.each** (Jest, Vitest): an array of rows or a tagged template table, with the case name in the test title.
- **Table-driven tests** (Go and others): a slice of cases looped with one named subtest per row.

## Report as

A test-only change that removes copies. Name the duplicated tests and the values that vary between them. Effort is low; the only real risk is dropping a case, which counting the reported cases catches.
