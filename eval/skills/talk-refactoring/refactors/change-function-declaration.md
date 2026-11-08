---
refactor: change-function-declaration
title: Change Function Declaration
direction: reshape
behavior: preserving
risk: low
smells: [inconsistent-solutions, speculative-generality, dead-code, narrating-comments, misleading-interface]
requires: [characterization-test]
---

# Change Function Declaration

Rename a function, variable or field, or add, remove or reorder parameters, and update every caller to match. For widely used functions, migrate in stages: the old name forwards to the new one until all callers have moved. From Fowler's Change Function Declaration (ch. 6), which covers Rename Function, Add Parameter and Remove Parameter, with Feathers' Preserve Signatures (ch. 23) as the guard.

## Use when

- A name is generic or misleading, and a comment exists only to explain it.
- One concept goes by several names across modules (`user`, `account`, `member`) and the codebase has a dominant term.
- A parameter is unused, or every call site passes the same value.
- A function needs a value it currently reaches for from global state (see [Inject Dependency](inject-dependency.md) for that case).

## Don't use when

- The code has no tests and you are in the middle of breaking dependencies to add them. Keep signatures exactly as they are, copied verbatim, and clean them up once tests exist (Preserve Signatures).
- The function is part of a published API and a deprecation cycle isn't in scope. Record the finding as "later".
- The new name is only a matter of taste and the old one matches local convention.

## Preconditions

- Tests that exercise the function, or a [Characterization Test](characterization-test.md). A pure rename done by a language-aware tool is the one case that can proceed without them.
- Every caller found: map importers, the type checker, and a text search for the name in strings, config and docs.

## Steps

For a function with few callers:

1. Change the declaration and the body.
2. Update every caller. Run the type checker and tests.

For a widely used or exported function (migration):

1. Extract the body into a new function with the new name or signature.
2. Make the old function forward to the new one, adapting arguments. Run the tests.
3. Move callers to the new function in small batches, running the tests after each batch.
4. When no callers remain, delete the old function. For a public API, mark it deprecated first and delete it in a later release.

In both cases, lean on the compiler: make the change and let the type checker list every site that must follow.

## Verify

The type checker and tests pass, no reference to the old name remains (or only the deprecated forwarder does), and every caller passes arguments that match the new parameters.

## Variants

- **Rename Variable / Rename Field** (Fowler): the same move for data. For persisted fields, renaming also needs a data migration; treat that as a behavior change.
- **Remove Parameter**: drop an unused or always-constant parameter. Often follows [Remove Dead Code](remove-dead-code.md).
- **Add Parameter**: the first step of [Parameterize Function](parameterize-function.md) and of passing a dependency in.
- **Rename to state the effect**: for a [Misleading Interface](../smells/misleading-interface.md), choose a verb that says what a caller must know (`reportProgress` for a user-visible write, `assertCurrent` for a check that throws, `ensurePull` for find-or-create-and-update). Rename one coherent surface together, such as every public method of one class, so the names form one model. If no honest name is short, the behavior is the problem, not the name.
- **Remove Flag Argument** (Fowler): replace a boolean parameter that switches behavior with one function per behavior, so call sites say which they mean.
- **Narrow a parameter**: accept only what the function uses (`{ id: string }` instead of a whole `Sandbox`), so the signature shows how little it depends on.
- **Narrow the public surface**: stop exporting internal primitives from a module's public entry instead of renaming each of them. Callers that need them are a signal the intended API is missing something.

## Report as

A reshape that removes the need for a reader to translate a name or ignore a parameter. Name the old and new declarations and the number of callers. Low risk for internal functions with tests; say when the migration path is needed and when the function is public, since that raises the risk.
