---
refactor: inline-function
title: Inline Function
direction: remove
behavior: preserving
risk: low
smells: [shallow-modules, speculative-generality, reinvented-logic, scattered-knowledge]
requires: []
---

# Inline Function

Replace calls to a function with its body, then delete the function, when the body says as much as the name or when the split hides more than it explains. The inverse of [Extract Function](extract-function.md). From Fowler's Inline Function (ch. 6), with Beck's One Pile (*Tidy First?* ch. 13) and Ousterhout's joining of conjoined methods (§9.7) folded in.

## Use when

- The function body is one or two lines that restate its name, or forward to another call with the same arguments.
- A helper is called from one place and only makes sense when read together with its caller.
- A chain of tiny single-use helpers must all be opened to follow one behavior.
- Two near-identical functions should be merged, and inlining one of them is the first step toward the merge.
- A decision is split across several small functions and gathering it in one place is the cleaner fix.

## Don't use when

- The function is polymorphic: a subclass overrides it, or it implements an interface method.
- The name carries real intent the body doesn't (a domain rule, a hidden subtask), even if only one caller uses it today.
- It is a public API, a framework hook, or a deliberate test seam.
- Inlining would copy a non-trivial body into many callers. That creates the duplication [Reinvented Logic](../smells/reinvented-logic.md) describes.

## Preconditions

- Every caller found: use the map's importers, a type checker, then a text search for the name (including dynamic or string references).
- The body has no early returns or recursion that would change meaning when pasted into a caller, or a plan to restructure them.

## Steps

1. Confirm the function isn't overridden and isn't referenced by name from config, reflection or a registry.
2. Pick one call site. Replace the call with the body, renaming parameters to the caller's arguments and turning returns into assignments.
3. Run the tests and the type checker.
4. Repeat for each remaining call site, testing after each.
5. Delete the function and any import that now has no use. Run the full test suite.

## Verify

The function no longer exists, no caller references it, and the test suite passes unchanged. Each former caller reads at least as clearly as before.

## Variants

- **One Pile** (Beck): when code is split into many small pieces that only make sense together, inline all of them into one routine, understand it, then re-split along better lines with [Extract Function](extract-function.md). Commit the inlined version first so the re-split is a separate, reviewable step.
- **Join conjoined methods** (Ousterhout): when a parent and its helper can't be understood apart (the helper takes many of the parent's locals, or returns values the parent immediately unpacks), join them back into one function. Split again only if each piece can stand alone from its name.

## Report as

A structure removal that saves the reader a hop and an interface to learn. Name the function, its caller count, and why the name adds nothing. Effort scales with the number of call sites; One Pile is a larger, two-commit change and should be labeled as such.
