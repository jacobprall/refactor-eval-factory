---
refactor: inject-dependency
title: Inject Dependency
direction: add
behavior: preserving
risk: low
smells: [hardwired-dependencies, implementation-coupled-tests]
requires: []
---

# Inject Dependency

Pass a collaborator in (as a constructor argument, a function parameter or a plain value) instead of having the code create it or reach for it through a global, an import or the environment. A default keeps existing callers working unchanged. The inverse is Replace Parameter with Query (Fowler). Merged from Feathers' Parameterize Constructor and Parameterize Method (ch. 25), Kerievsky's Extract Parameter (ch. 11), Fowler's Replace Query with Parameter (ch. 11) and Beck's Explicit Parameters (Tidy First?, ch. 10).

## Use when

- A function or constructor creates a client, connection, clock or random source inline, and a test needs to substitute it. Feathers' enabling-point check fails: there is no place outside the function to choose the implementation.
- Business logic reads `process.env`, `os.environ` or a module-level singleton deep in the call tree.
- Tests patch module paths (`jest.mock`, `unittest.mock.patch`) only because nothing can be passed in.
- A function's signature doesn't reveal what it depends on.

## Don't use when

- The collaborator is a pure, deterministic helper with no I/O. Nothing needs substituting.
- The code is the composition root, whose job is to create and wire collaborators.
- No test, second implementation or pending change needs the substitute. Added indirection is itself a cost: every injected parameter is one more thing a caller can get wrong.
- The parameter list is already long. Group the dependencies first, or inject one object that holds them.

## Preconditions

- None required. This is one of Feathers' dependency-breaking moves, meant to be done carefully before tests exist so that tests can be written. Do it mechanically: copy signatures exactly (Preserve Signatures) and let the type checker find every call site (Lean on the Compiler).
- Know which kind of seam you need: sensing (record what the code sends out) or separation (keep a slow or unsafe dependency out of the test).

## Steps

1. Find the creation or lookup: `new Client()`, `createClient()`, `getInstance()`, an environment read, `Date.now()`.
2. Add a parameter for it whose default performs the original creation or lookup (`constructor(client = new Client())`, `def f(x, now=time.time)`). The default must behave exactly as the old code did.
3. Replace the inline use with the parameter. Run the type checker and the tests; nothing else should change.
4. Write the test that motivated the move, passing a fake or stub through the new parameter.
5. Optionally, in a separate step, move the default up to the composition root so creation happens in one place, updating callers one at a time.

## Verify

Existing callers compile and pass without edits. The new test passes a substitute and no longer patches a module path. A search for the old inline creation finds it only in the default or the composition root.

## Variants

- **Parameterize Constructor** (Feathers): pass in an object the constructor used to create, keeping a convenience constructor that supplies the default.
- **Parameterize Method** (Feathers): the same for an object created inside one method; keep the old signature as a delegating overload if the language lacks default arguments.
- **Extract Parameter** (Kerievsky): a field assigned from an internally created object becomes a value the caller passes in.
- **Replace Query with Parameter** (Fowler): pass a value in instead of having the function read global or ambient state, which can make the function pure.
- **Explicit Parameters** (Beck): split a routine so an outer part gathers values from an options bag, globals or the environment and passes them explicitly to an inner part.

## Report as

A behavior-preserving add-structure move. Name the hidden dependency and the test or change that needs the seam, and confirm a default keeps existing callers unchanged. Effort is usually small; it grows only if the default is later moved up to a composition root.
