---
refactor: separate-query-from-modifier
title: Separate Query from Modifier
direction: reshape
behavior: preserving
risk: medium
smells: [hardwired-dependencies, tangled-function, misleading-interface]
requires: [characterization-test]
---

# Separate Query from Modifier

Split a function that both returns a value and changes state (writes, sends, mutates, creates) into a query that only computes and a modifier that only acts. Callers that need both call both. The computation can then be tested through its return value, without mocking the effect. From Fowler (ch. 11) and Command/Query Separation as Feathers applies it to undetectable side effects (ch. 10).

## Use when

- A function named like a question (`getX`, `findX`, `calculateX`, `isX`) also writes, sends, logs to an audit trail or creates records.
- Tests can only check the computed value by mocking the side effect, or can't check it at all.
- Some callers want only the value, and either trigger the effect anyway or copy the computation to avoid it.

## Don't use when

- The combination is atomic by design: pop from a queue, compare-and-swap, `INSERT ... RETURNING`, a get-or-create protected by a lock or unique constraint. Splitting would open a race.
- The effect is invisible to callers, such as memoizing the function's own result.
- The code returns a status or new ID from a command by convention. That isn't a hidden effect.

## Preconditions

- Every caller found, and for each one, whether it uses the return value, the side effect, or both.
- A [Characterization Test](characterization-test.md) that records both the returned value and the effect (what was written or sent), because callers will now perform them as two calls.

## Steps

1. Write the characterization test and run it.
2. Copy the function into a new query that returns the same value and performs no side effect. Name it as a question.
3. Run the tests.
4. At one caller that uses the return value, get the value from the query and keep the original call for its effect, preserving the original order. Run tests. Repeat for each caller.
5. When no caller uses the original's return value, remove it. The original is now the modifier; rename it as a command if its name was a question.
6. If the modifier recomputes what the query computes, have it call the query or take the value as a parameter.
7. Run the full test suite.

## Verify

The query reaches no I/O, module state or field assignment. The characterization test sees the same effect as before, and a new test checks the query directly with no mocks.

## Variants

- **Command/Query Separation** (Feathers): the framing for untested code. Separate the computation so a test can observe it. When the modifier still talks to I/O, follow with [Inject Dependency](inject-dependency.md) or [Humble Object](humble-object.md).

## Report as

Behavior-preserving as long as callers keep the original order of value and effect. Name the function, the effect it hides and the callers that only wanted the value. Effort scales with the number of callers. Keep the medium risk label, and raise it if the pair was concurrency-sensitive.
