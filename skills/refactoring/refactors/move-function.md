---
refactor: move-function
title: Move Function / Move Field
direction: reshape
behavior: preserving
risk: low
smells: [scattered-knowledge, overloaded-module, import-tangle, shallow-modules, swallowed-errors, reinvented-logic]
requires: []
---

# Move Function / Move Field

Relocate a function or field to the module whose data and knowledge it uses most, so related code changes in one place. From Fowler's Move Function and Move Field (ch. 8), with Feathers' Expose Static Method (ch. 25) and Ousterhout's advice to push special-purpose code out of general mechanisms (§6.6, §9.4) folded in.

## Use when

- A function uses another module's data more than its own.
- One rule or format is handled in several modules, and moving the pieces next to the owner gives it one home.
- A module carries code for several unrelated jobs, and some of it belongs elsewhere.
- Two modules import each other because one function sits on the wrong side. Moving it breaks the cycle.
- A thin layer should stay, but needs real work to stop being shallow.
- The same input is validated in several internal layers instead of once at the system boundary.

## Don't use when

- The function is used about equally from several modules. Moving it just moves the coupling.
- The move would create a new import cycle or make a stable module depend on a less stable one. Check the map first.
- The target module is already overloaded.

## Preconditions

- What the function uses in its current home listed: fields, helpers, imports. Decide whether those move too.
- The function is not overridden or registered by name, or a plan for those references.
- Tests cover the function, or a type checker that will catch broken references. When there are no tests, copy the signature exactly and change nothing else (Preserve Signatures).

## Steps

1. Copy the function into the target module. Adjust references to the context it now lives in, keeping the signature unchanged.
2. Run the type checker on both modules.
3. Turn the original into a forwarder that calls the new function. Run the tests.
4. Move callers to the new location, testing after each batch.
5. Delete the forwarder once nothing calls it. If it must stay for external callers, mark it deprecated.
6. For a field: move the field, route reads and writes through accessors on the new owner, then update users, testing after each step.

## Verify

The function or field lives in one place, the old location has no remaining references (or only a deprecated forwarder), the tests pass, and the import graph has no new cycle.

## Variants

- **Move Field** (Fowler): move data to the structure that uses it most or changes with it.
- **Expose Static Method** (Feathers): if a method uses no instance state, make it a static or free function so it can be tested without building the object. Often a first step before moving it.
- **Push specialization into callers** (Ousterhout): move a branch or flag that serves one caller out of a shared function and into that caller, leaving the shared function general.
- **Move validation to the boundary**: delete repeated internal checks and keep one at the boundary where input enters the system.

## Report as

A reshape that gives one piece of knowledge one owner. Name the function, its current and target modules, and the evidence (data used, co-change, cycle). Effort scales with the number of callers; moving validation to the boundary changes where failures surface, so say so.
