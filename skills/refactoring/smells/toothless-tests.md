---
card: toothless-tests
title: Toothless Tests
scope: local
bundle: test
inputs: [code, git, tests]
evidence: practitioner + measured* (benchmark, no baseline)
also_check: [swallowed-errors, implementation-coupled-tests, hardwired-dependencies]
refactors: [assert-on-outcome, characterization-test, remove-dead-code]
---

# Toothless Tests

Tests that pass whether or not the behavior works: no assertions or only trivial ones, printing instead of asserting, skipped, swallowing their own failures, recomputing the expected value the way the code does, or bent to fit the code. They give false confidence, and every other refactoring relies on them.

## Signals

Read this section to find candidates. If nothing here matches the code in front of you, skip the rest of the card.

- `toothless-tests.survives-stub`: the test still passes after the body of the function under test is replaced with a trivial stub. This is a probe: it needs the test suite to run, so only when the user allows it. When available, it settles the question.
- `toothless-tests.assertion-free-file`: a test file that defines test cases but contains no assertions.
- `toothless-tests.skip-marker`: `it.skip`, `xit`, `test.todo`, `@pytest.mark.skip`, `xfail`. Check git for when and why it was added.
- `toothless-tests.print-in-test`: `console.log` or `print` in test bodies, often standing where an assertion should be.
- `toothless-tests.weak-assertion`: assertions that pass for almost any value (`toBeDefined()`, `toBeTruthy()`, `assert result`, `is not None`).
- `toothless-tests.swallow-in-test`: a catch inside a test that is empty or only logs, so the failure the test should report never reaches the runner. A `try`/`finally` for cleanup is not this.

Reading cues with no machine signal:

- The expected value is a constant imported from the module under test, or the actual value is compared with itself.
- The expected value is computed with the same algorithm as the code under test.
- Assertions only on values the test itself put into a mock.
- Production branches keyed to a test's literal input, or comments naming a specific test ("special case for test_x").
- Test-file edits inside a change whose stated goal was to fix code. Treat this as a warning sign: the test may have been weakened to match the code.
- Commented-out test bodies, or tests dropped from the suite configuration.

## Judgment

### Confirm by

1. When probes are allowed, run the strongest check: replace the function under test with a stub that returns an empty value or a constant, and run the test. If it still passes, it is toothless. Restore the function afterwards.
2. Without probes, read each assertion and ask which wrong implementation would still pass it. If a function returning `{}` or `true` passes, the assertion is too weak.
3. For skips and edited tests, use git: in which change did the skip or the loosened assertion appear? One added in the same commit as a code fix, with no tracked reason, is the finding.
4. For expected values, trace where they come from. A literal taken from the spec is fine. A value derived the same way the code derives it can't disagree with the code.
5. For production special cases, search the source for the test's literal inputs.
6. Quote the test and the assertion (or its absence), and for git findings the commit that introduced it.

### Not a finding

- Smoke tests explicitly named and documented as "does not throw" or "renders without crashing".
- Contract tests that deliberately pin a public constant or schema.
- Skips with a tracked reason and an expiry or issue link (platform-specific skips, known upstream bugs).
- Table-driven loops where the runner reports each case.
- A try block that asserts on the caught error and fails the test when nothing is raised.
- Prints that run only on a failure path, as diagnostics.

### Boundaries

- A catch in production code belongs to [Swallowed Errors](swallowed-errors.md). A catch inside a test belongs here.
- Tests that check the right thing through mocked internals belong to [Implementation-Coupled Tests](implementation-coupled-tests.md). A test that asserts only on a mock's canned return value checks nothing and stays here.
- `NODE_ENV === 'test'` branches and `*ForTesting` hooks in production belong to [Hardwired Dependencies](hardwired-dependencies.md). A branch keyed to one test's literal input stays here.
- Tests that work but are hard to read belong to [Bloated Test Setup](bloated-test-setup.md).

### Also check

- [Swallowed Errors](swallowed-errors.md): when the tests can't fail, the code's failure paths are usually untested and often masked.
- [Implementation-Coupled Tests](implementation-coupled-tests.md): heavy mocking and toothless assertions tend to appear together, because the mock decides what the test sees.
- [Hardwired Dependencies](hardwired-dependencies.md): test-only branches in production usually come with tests that exercise the branch rather than the behavior.

### Refactors

- [Assert on Observable Outcome](../refactors/assert-on-outcome.md): the default. Replace prints and weak assertions with assertions on the real return value or resulting state, and watch each one fail before it passes. Also covers re-enabling or deleting skipped and lost tests.
- [Characterization Test](../refactors/characterization-test.md): when nobody knows the correct expected value. Record current behavior, label it as such, and confirm it with the owner.
- [Remove Dead Code](../refactors/remove-dead-code.md): for production special cases keyed to test inputs. Delete the branch, then fix the code or the test honestly. **Changes behavior** for that input: label it.

## Evidence

Practitioner: Anthropic's Claude 3.7 Sonnet system card reports that after repeated failures the model sometimes returned expected test values directly or edited tests to match its output, and METR saw it edit a provided test file so everything passed. Anthropic describes this as rare in normal use. Beck names disabling or deleting tests as one of three signs an agent is off track, and Pocock reports agent tests that reassert constants. Measured, benchmark only with no human baseline: on SWE-bench Verified runs, agent-written tests mostly printed values rather than asserting (Chen et al.). These were tests written during the run, not necessarily committed ones.

## Aliases

Neverfail Test, Manual Result Verification, Lost Test, Buggy Tests, and the Production Logic in Test cause of Conditional Test Logic (Meszaros ch. 15-17); Empty Test, Unknown Test, Redundant Assertion, Redundant Print, Ignored Test and Exception Handling (tsDetect); tautological tests (Pocock); gamed or special-cased tests (agent-code research).
