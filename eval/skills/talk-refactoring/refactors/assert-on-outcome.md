---
refactor: assert-on-outcome
title: Assert on Observable Outcome
direction: test
behavior: preserving
risk: low
smells: [toothless-tests, implementation-coupled-tests]
requires: []
---

# Assert on Observable Outcome

Make a test check the result it is supposed to protect: replace missing, trivial or print-based checks with assertions on the returned value, the resulting state or the emitted output, and restore or delete tests that no longer run. The goal is a test that fails when the behavior breaks. From Meszaros' Self-Checking Test, Guard Assertion (ch. 21) and his remedies for Neverfail and Lost Test (ch. 17). Changes test code only.

## Use when

- A test has no assertion, or only `toBeDefined`, `is not None`, `assert True`, or a check on a value the test itself set.
- A test prints or logs values for a person to read instead of asserting them.
- The expected value is computed by the same algorithm as the code under test, or imported from it.
- A `try/catch` in the test swallows the failure, or an `if` decides whether to assert at all.
- A test was skipped, commented out or dropped from the suite without a tracked reason.
- Assertions check implementation details (call counts, private fields, a `toString` rendering) where an outcome is observable.

## Don't use when

- The test is a smoke test explicitly named and documented as "does not throw".
- The skip has a tracked reason and an expiry.
- String output is the feature (a serializer, a CLI), so comparing strings is asserting on the outcome.

## Preconditions

- The behavior the test is meant to protect, stated in one sentence. If nobody can say what it is, the test may be a candidate for deletion.
- For a skipped or removed test, the reason it was skipped, from git history.

## Steps

1. Run the stub-the-body check: replace the code under test with a trivial body and run the test. If it still passes, it is toothless. Revert.
2. Name the observable outcome: a return value, a state change visible through the public interface, or an output recorded by a fake.
3. Replace prints and trivial checks with assertions on that outcome. Use literal expected values worked out by hand, not recomputed the way the code computes them.
4. Replace an `if` that guards assertions with a Guard Assertion that fails when the precondition doesn't hold. Replace a swallowing `try/catch` with the framework's expected-error assertion (`pytest.raises`, `expect(...).toThrow()`).
5. For a lost test, re-enable it and run it. If it fails because the code is wrong, report the bug rather than changing the expectation to match. If the behavior it covered was removed on purpose, delete the test.
6. Repeat the stub-the-body check. The test must now fail.

## Verify

Each changed test fails with the body stubbed and passes with the real code. No new skips appear in the diff. Restored tests run in CI.

## Variants

- **Self-Checking Test** (Meszaros): the test decides pass or fail itself; no person has to read its output.
- **Replace prints with assertions**: each printed value becomes an assertion on that value.
- **Guard Assertion** (Meszaros): an assertion replaces conditional logic inside a test.
- **Restore or delete Lost Tests** (Meszaros): re-enable a skipped or dropped test, or remove it if the behavior it covered is gone.

## Report as

A test-only change; production behavior is untouched, though restoring a lost test can expose a real bug, which should be reported as its own finding. Name the tests that failed the stub-the-body check and the outcome each will now assert. Effort is low per test.
