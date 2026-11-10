---
refactor: replace-mock-with-fake
title: Replace Mock with Fake or Real Collaborator
direction: test
behavior: preserving
risk: low
smells: [implementation-coupled-tests]
requires: []
---

# Replace Mock with Fake or Real Collaborator

In a test, swap a mock that verifies calls to an internal collaborator for the real collaborator or a small working fake, and assert on the result or the resulting state instead of on the calls. The test then checks what the code achieves rather than how, and survives behavior-preserving refactors. Merged from Meszaros' Fake Object, State Verification over Behavior Verification and Use the Front Door First (xUnit Test Patterns, ch. 5, 21, 23) and Feathers' fakes and sensing vs. separation (ch. 3). Changes test code only.

## Use when

- A test mocks modules in the same package as the code under test and asserts call order, call counts or exact arguments.
- A behavior-preserving refactor broke tests even though results didn't change.
- A double does neither of the two jobs Feathers gives it: sensing (recording an output the test can't otherwise see) or separation (isolating a slow or unsafe dependency such as a network, database or clock). A mock that does neither only mirrors the implementation.
- A mock's programmed answers have drifted from what the real collaborator does.

## Don't use when

- The interaction is the requirement, at an architectural boundary: an email is sent, an event published, a payment API called. Verifying that call is right. A fake that records sent messages can still read more clearly than a mock there.
- The real collaborator is slow, nondeterministic or unsafe, and no fake exists yet. Write the fake first, or keep a stub for separation.
- The codebase follows mockist TDD by convention. Lower the priority and match the local style unless the tests are actively breaking on refactors.

## Preconditions

- The test passes today.
- A label for each double in the test: sensing, separation, or neither.

## Steps

1. Classify each double. Keep doubles that provide separation at a real boundary; target those that do neither and those that verify calls between internal units.
2. Replace an internal mock with the real collaborator if it is fast and deterministic. Otherwise write a fake: a small working implementation (an in-memory repository, a map-backed cache, a clock the test sets) with extra methods the test uses to inspect it.
3. Remove the call assertions for that collaborator. Assert instead on the returned value or on state visible through the public interface.
4. Run the test. Then check it still has teeth: break the production behavior (stub the function body, flip a branch) and confirm the test fails. Revert.
5. Repeat for the next double. Move a fake that several tests need into a shared test helper.

## Verify

The test fails when the behavior breaks and passes when the implementation is restructured without changing results. Each remaining mock sits at an architectural boundary or isolates a slow or unsafe dependency.

## Variants

- **Fake Object** (Meszaros, Feathers): a lightweight working implementation, such as an in-memory database, used in place of the real one.
- **State Verification over Behavior Verification** (Meszaros): check results and state when they are observable; verify calls only when the call is itself the outcome.
- **Use the Front Door First** (Meszaros): exercise and observe the code through its public interface before reaching for back doors or interaction checks.

## Report as

A test-only change; production behavior is untouched. Name the mocks removed, which job each was doing (sensing, separation or neither), and the assertion that replaces it. Effort scales with how many tests share the mocked setup; writing a reusable fake is the main up-front cost.
