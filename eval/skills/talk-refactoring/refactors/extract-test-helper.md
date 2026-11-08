---
refactor: extract-test-helper
title: Extract Test Helper
direction: test
behavior: preserving
risk: low
smells: [bloated-test-setup, implementation-coupled-tests]
requires: []
---

# Extract Test Helper

Move repeated or noisy test setup and verification into named helpers, so each test shows only the values that matter to it. Merged from Meszaros' Creation Method, Custom Assertion, Test Utility Method, Minimal Fixture and Fresh Fixture (xUnit Test Patterns, ch. 18 to 24), with the Test Data Builder as the builder form of a Creation Method. Changes test code only.

## Use when

- Several tests build the same object with many literals, and only one or two values differ between them.
- A test populates every field of an object although its assertion depends on one.
- The same multi-line verification is copied across tests, or a test compares `toString` or JSON output when it means to compare objects.
- A shared `beforeEach` or `setUp` builds a large fixture that each test uses only part of.
- A helper, factory or fixture already exists and new tests don't use it. Use it rather than writing another.

## Don't use when

- The repetition is what keeps each test readable on its own. When DRY and DAMP (descriptive and meaningful phrases) conflict in tests, prefer DAMP: a reader should understand a test without opening several helper files.
- The helper would hide a value the assertion depends on. Pass that value explicitly at the call site.
- Only two tests share a couple of lines.

## Preconditions

- The tests pass today.
- A search of the test tree for existing helpers, factories, builders and fixtures.

## Steps

1. Pick the most repeated setup. Write a Creation Method (`makeUser({ plan: "pro" })`) that fills every field with a sensible default and accepts overrides.
2. Change one test to use it, passing only the values its assertion depends on. Run the test.
3. Change the remaining tests one at a time, running each after the change.
4. For repeated verification, extract a Custom Assertion (`assertInvoiceTotals(invoice, expected)`) that compares the meaningful fields and reports which one differed.
5. Shrink shared setup: move anything only some tests need out of `beforeEach` and into those tests or a helper they call (Minimal Fixture). Build state per test rather than sharing mutable state across tests (Fresh Fixture).
6. Read each changed test on its own. If it no longer says what it checks, inline the helper call or make its arguments explicit.
7. Run the full suite, in random order if the runner supports it.

## Verify

Each test names the values that drive its assertion. Changing the constructor of a shared type touches the helper, not every test. The suite passes in any order.

## Variants

- **Creation Method / Test Data Builder** (Meszaros; the builder is a common extension): construct objects with defaults so tests name only what matters.
- **Custom Assertion** (Meszaros): a named check for repeated or domain-specific comparisons; also the fix for comparing string renderings.
- **Test Utility Method** (Meszaros): any reusable test step, including wrapping the API of the code under test so an interface change touches one place.
- **Minimal Fixture / Fresh Fixture** (Meszaros): the smallest setup each test needs, built anew for each test.

## Report as

A test-only change. Name the repeated setup or verification and the helper that replaces it, and show one test before and after. Effort scales with the number of tests touched; check that each test still reads clearly on its own.
