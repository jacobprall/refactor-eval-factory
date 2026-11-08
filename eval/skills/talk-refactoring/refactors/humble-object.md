---
refactor: humble-object
title: Humble Object
direction: add
behavior: preserving
risk: medium
smells: [hardwired-dependencies, implementation-coupled-tests]
requires: [characterization-test]
---

# Humble Object

Move the logic out of code that is hard to test (a UI event handler, a framework callback, a route handler, a thread or job body) into a plain function or object that can be tested directly, and leave the boundary so thin it barely needs a test. From Meszaros (xUnit Test Patterns, ch. 26). The "functional core, imperative shell" style applies the same idea to a whole module.

## Use when

- A route handler, event handler, CLI command or queue consumer mixes validation, decisions and I/O in one function that returns nothing, so its effects can't be observed.
- Tests have to start a server, render a component, spin up a thread or `sleep` to check a calculation.
- Tests mock the framework's request, response or context objects to reach the logic, which ties them to the framework's API.

## Don't use when

- The boundary code is already thin glue with no decisions in it. Cover it with an integration test.
- The extracted unit would only forward to the framework. Added indirection is itself a cost; the move needs a concrete driver, such as logic you want to test without the framework or a second entry point (a CLI and an HTTP route) that should share it.
- The logic and the side effects can't be separated without changing the order of effects that callers rely on. Pin that order first and treat the change as a behavior change.

## Preconditions

- A [Characterization Test](characterization-test.md) at the boundary (an HTTP-level or component-level test) recording the observable outcome of the main paths.
- A clear line between deciding and doing: which parts compute a result and which parts send, write, render or log it.

## Steps

1. Write the boundary characterization test and run it.
2. Identify the values the logic needs from the framework objects: request fields, props, the message body.
3. Extract the decision logic into a plain function that takes those values and returns a result, such as data to render, a response description or a list of effects to perform. Move code unchanged where possible.
4. Have the boundary call the function and carry out what it returns. Run the characterization test.
5. Write direct unit tests for the plain function covering its branches, with no framework objects and no mocks.
6. Delete boundary-level tests that existed only to reach the logic, keeping one or two that check the wiring.
7. Run the full suite.

## Verify

The characterization test passes unchanged. The new function's tests construct only plain values. The boundary has no branches beyond calling the function and acting on its result.

## Report as

A behavior-preserving add-structure move. Name the boundary, the logic moved out, and the mocks or slow setup it removes from tests. Effort scales with how tightly decisions and effects are interleaved; the risk is reordering side effects, which the boundary test must catch.
