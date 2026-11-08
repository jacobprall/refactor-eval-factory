---
refactor: inline-class
title: Inline Class
direction: remove
behavior: preserving
risk: medium
smells: [shallow-modules, speculative-generality, import-tangle, scattered-knowledge]
requires: [characterization-test]
---

# Inline Class

Fold a class or module that no longer pulls its weight into the one that uses it most, then delete it. The inverse of [Extract Class / Module](extract-module.md). From Fowler's Inline Class (ch. 7), with Collapse Hierarchy, Remove Subclass (ch. 12) and Replace Command with Function (ch. 11) folded in, and Ousterhout's case for merging shallow pieces into a deeper module (ch. 4).

## Use when

- A class has one or two methods that forward to, or are only used by, one other class.
- A `*Manager`, `*Handler` or `*Service` adds a name but hides no decision.
- An abstract base or interface has a single implementation and no fake.
- Two modules import each other and really describe one concept, so merging them removes the cycle.
- One piece of knowledge is split across two small classes that always change together.

## Don't use when

- The class isolates a third-party API or is a test seam with a real fake.
- It is a published API or a framework extension point.
- The absorbing class is already an [Overloaded Module](../smells/overloaded-module.md). Merging would make it worse; consider [Move Function](move-function.md) to give the thin class real work instead.
- The class has a concrete, near-term second implementation. Ask, or flag it.

## Preconditions

- A [Characterization Test](characterization-test.md) of the behavior that flows through the class, if none exists.
- Every reference found: imports, type annotations, `instanceof` checks, DI registration, and string references in config.

## Steps

1. Choose the absorbing class: the one that uses the inlined class most.
2. For each public member of the inlined class, add a member on the absorbing class that delegates to it. Run the tests.
3. Change every client to use the absorbing class instead. Run the tests after each module of clients.
4. Move the fields and method bodies into the absorbing class, replacing the delegations. Run the tests.
5. Delete the inlined class, its file and its registrations. Run the full suite and the type checker.

## Verify

The class and its file are gone, no import or registration references it, and the tests pass unchanged. If a cycle motivated the change, the import graph no longer shows it.

## Variants

- **Collapse Hierarchy** (Fowler): merge a subclass and its parent when they no longer differ enough to justify two types. Usually removes an abstract base with one concrete child.
- **Remove Subclass** (Fowler): replace subclasses that differ only in a constant or a flag with a field on the parent.
- **Replace Command with Function** (Fowler): turn a class with a constructor and a single `execute` or `run` method into a plain function.
- **Merge into a deeper module** (Ousterhout): combine several shallow modules that share knowledge into one module with a smaller total interface.

## Report as

A structure removal that saves a file, a type and an interface to learn. Name the class, what it forwards to, and the absorbing class. Effort scales with the number of clients and registration points; medium risk because type checks and DI wiring can hide references.
