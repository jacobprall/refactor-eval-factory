---
refactor: inline-singleton
title: Inline Singleton
direction: remove
behavior: preserving
risk: medium
smells: [speculative-generality, hardwired-dependencies]
requires: [characterization-test]
---

# Inline Singleton

When code needs an object but not a global way to reach it, create the object once where the application is wired together, pass it to the code that uses it, and delete the singleton machinery. A move away from a pattern; the inverse is Limit Instantiation with Singleton. From Kerievsky's Inline Singleton (*Refactoring to Patterns* ch. 6).

## Use when

- A singleton exists for convenient access, not because only one instance can exist or profiling showed a need.
- Tests have to reset, patch or monkey-patch the global instance to run.
- A module-level client (`export const db = createClient()`) is imported deep inside business logic.
- The singleton holds trivial behavior and mostly serves as a global access point.

## Don't use when

- There really must be one instance (a hardware handle, a process-wide lock) and the code already passes it explicitly where it matters.
- The instance is immutable config loaded once and nothing needs to substitute it.
- The singleton has so many users that threading it through is out of scope. Use [Encapsulate Variable](encapsulate-variable.md) as an interim step and record the finding as "later".

## Preconditions

- A [Characterization Test](characterization-test.md) around one or two main users, if none exists.
- Every access point found: the accessor (`getInstance()`, the module export), plus any reset or setter used by tests.
- A composition root identified: `main`, the app factory, or the request handler setup where the object can be created.

## Steps

1. Create the instance at the composition root, using the same construction the singleton used.
2. Pick one user. Give it the instance through a constructor or function parameter, keeping a default that falls back to the singleton so other callers don't change. See [Inject Dependency](inject-dependency.md). Run the tests.
3. Pass the root's instance into that user. Run the tests.
4. Repeat for each user. Update tests to pass a real or fake instance instead of resetting the global.
5. Remove the fallback defaults, then delete the static accessor, the stored instance and any test-only reset. Run the full suite.

## Verify

No code reads the global accessor, tests construct or pass the instance themselves, and the suite passes unchanged. The object is still created once in production, at the root.

## Variants

- **Module-level instance**: in JavaScript or Python the singleton is often an exported instance rather than a class with `getInstance()`. The steps are the same; the final deletion removes the export.

## Report as

A structure removal that saves a global access point and the test-only reset hooks that come with it. Name the singleton, its number of users, and the composition root that will own the instance. Effort scales with the number of users; medium risk because initialization order can change.
