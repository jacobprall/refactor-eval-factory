---
refactor: characterization-test
title: Characterization Test
direction: safety
behavior: preserving
risk: low
smells: [swallowed-errors, toothless-tests]
requires: []
---

# Characterization Test

Write tests that record what the code does now, including its bugs, before changing it, so the change can be checked against them. From Feathers (ch. 12 and 13), who coined the term; golden master and approval testing are the whole-output form. This is the precondition other cards require when the code they touch has no tests that would catch a change.

## Use when

- A refactor or behavior change is planned for code with no tests, or with tests that fail the stub-the-body check.
- Another card lists it under `requires`.
- You need to know what the code actually does, as opposed to what its name or comments claim.

## Don't use when

- Existing tests already fail when the targeted behavior breaks. Confirm with the stub-the-body check, then rely on them.
- The code can't be called from a test yet. Make the smallest dependency-breaking move first ([Inject Dependency](inject-dependency.md), [Extract Interface](extract-interface.md), [Encapsulate Variable](encapsulate-variable.md)), then write the characterization test straight after.
- The output depends on time, randomness or ordering you can't control. Inject the clock or seed first, or normalize those values before comparing.

## Preconditions

- None. A way to call the code from a test is all it needs.

## Steps

1. Pick the test points. Prefer a pinch point, a function or endpoint that the effects of the whole change pass through, so a few tests cover it. Cover the area you will change first, then the specific behaviors you will modify.
2. Call the code in a test with a realistic input and assert a value you expect to be wrong (`expect(result).toEqual("?")`).
3. Run it, read the actual value from the failure message, and change the assertion to match. Repeat for each input. Agents are good at this run, read the failure, fix the expectation loop.
4. Target the paths the change touches: add inputs that reach each branch you will modify, including failure paths, and confirm each input really reaches its branch (Targeted Testing).
5. When the output is large (a rendered page, a report, an API payload), record it as a golden master file next to the test and compare against it, after normalizing timestamps and generated ids.
6. Do the stub-the-body check: replace the function body with a trivial return and run the tests. They must fail. Revert.
7. When a recorded value looks like a bug, keep the assertion matching current behavior, mark it as suspected in the test name or a comment, and report it. Fixing it is a separate, labeled behavior change.

## Verify

The tests pass on the current code, fail with the body stubbed, and exercise every branch the planned change touches. No expectation was written from a guess about intended behavior rather than from an observed run.

## Variants

- **Targeted Testing** (Feathers): aim tests at the branches and conversions the change will touch, and check that each test actually exercises its path.
- **Pinch Point placement** (Feathers): put a few tests where many effects converge. Treat them as scaffolding and replace them with focused tests once the code is split, before they grow into slow mini-integration tests.
- **Golden master**: record the whole output once and compare later runs against it.
- **Stub-the-body check**: stub out the code under test and confirm the tests fail. A test that still passes protects nothing.

## Report as

A safety step that adds tests and changes no production code. Name the test points and the behaviors pinned, and list any suspected bugs as separate findings. Effort scales with the number of branches the planned change touches.
