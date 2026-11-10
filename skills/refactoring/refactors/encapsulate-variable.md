---
refactor: encapsulate-variable
title: Encapsulate Variable
direction: add
behavior: preserving
risk: low
smells: [hardwired-dependencies]
requires: []
---

# Encapsulate Variable

Route every read and write of widely shared data (a module-level variable, a global config object, a singleton) through functions, so access can be found, controlled and replaced in one place. Usually a first step before moving the data, making it immutable or passing it in. From Fowler (ch. 6), with Feathers' Encapsulate Global References, Replace Global Reference with Getter and Introduce Static Setter (ch. 25) as the testing-oriented forms.

## Use when

- Mutable module-level state (`let config = ...`, `export const cache = {}`, a shared `client`) is read or written from several modules.
- Tests share that state, need reset hooks, or pass and fail depending on run order.
- You plan to move or restrict the data and first need every access point in one place.

## Don't use when

- The value is an immutable constant loaded once. Reading it directly is fine.
- The state is used inside one module only. Keep it private there.
- Passing the value in is cheap. [Inject Dependency](inject-dependency.md) or [Inline Singleton](inline-singleton.md) removes the global instead of wrapping it.
- Nothing will use the new access functions: no test needs to replace the value and no change is pending. Added indirection is itself a cost, and getters over a variable nobody needs to control are noise.

## Preconditions

- Every access found: search for the variable name, including re-exports and destructured imports.
- No characterization test is required first. This is a dependency-breaking move from Feathers' catalog, safe before tests exist when each step is mechanical. Write the test that uses the new access point straight after.

## Steps

1. Write a getter, and a setter only if code writes the value, next to the variable.
2. Replace each direct reference with the getter, one module at a time. Run tests after each.
3. Make the variable private to its module (stop exporting it). The type checker or linter now finds any reference you missed.
4. If writes should be limited, have the getter return a copy or a read-only view, and narrow or remove the setter.
5. Write the test that needed control over the value, replacing it through the access functions rather than by patching the module.
6. Run the full suite, in random order if the runner supports it.

## Verify

A search finds the variable referenced only inside its own module. Tests replace the value through the access functions and pass in any order.

## Variants

- **Encapsulate Global References** (Feathers): gather several related globals into one object and access them through it, so the group can be replaced together.
- **Replace Global Reference with Getter** (Feathers): inside a class, read the global through an overridable getter that a test subclass can replace.
- **Introduce Static Setter** (Feathers): add a setter so tests can install a fake singleton instance. A last resort: it weakens the singleton's protection and leaves a test hook in production code. Prefer passing the instance in.

## Report as

A behavior-preserving add-structure move, usually preparatory. Name the shared state, the modules that touch it, and the follow-up it enables (injection, immutability, a move). Effort scales with the number of access sites; label any static setter as a stopgap.
