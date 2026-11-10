---
refactor: extract-interface
title: Extract Interface
direction: add
behavior: preserving
risk: low
smells: [hardwired-dependencies, import-tangle]
requires: []
---

# Extract Interface

Declare an interface (or protocol, or type) that lists only the operations callers use from a concrete class or module, make the concrete one implement it, and change callers to depend on the interface. From Feathers (ch. 25), and the dependency-inversion remedy for import cycles in architecture-smell research (Arcan). The inverse is to delete the interface and depend on the concrete type again, as in [Inline Class](inline-class.md).

## Use when

- There are, or will be as part of this change, two or more implementations. A test fake counts as the second.
- A constructor takes a concrete client that is hard to build in a test, and a fake needs a type to implement.
- An import cycle exists because a lower module calls up into a higher one. Declaring the interface on the lower module's side and having the higher module implement it makes the import point one way.

## Don't use when

- There is one implementation and no fake will be written. An interface with a single implementer is [Speculative Generality](../smells/speculative-generality.md).
- The language is structurally typed and a narrow parameter type is enough. In TypeScript, or Python with protocols, the fake may already satisfy the parameter's type with no named interface.
- Added indirection is itself a cost: every reader now has to find the implementation behind the interface. The move needs a concrete driver, such as the fake, a second backend or a cycle to break.

## Preconditions

- None required. Like the other dependency-breaking moves in Feathers' catalog, it is safe to do before tests exist if each step is mechanical and the type checker confirms it.
- The members callers actually use, from a search of call sites. Extract only those, not the class's whole public surface.

## Steps

1. List the members that callers, including the planned fake, use.
2. Declare the interface with those members, copying signatures exactly.
3. Make the concrete class implement it. Run the type checker.
4. Change one caller's parameter, field or import type from the concrete class to the interface. Run the type checker and tests. Repeat per caller.
5. For a cycle, move the interface declaration into the module that calls through it, and confirm with the map that the import now points one way.
6. Write the fake that implements the interface, and the test that needed it.

## Verify

Callers reference only the interface. The fake and the real class both type-check against it. For a cycle, the import graph no longer contains it.

## Variants

- **Dependency inversion** (architecture-smell remedy): the interface lives with its consumer and the provider depends on it, which breaks the cycle.
- **Extract Implementer** (Feathers): when the class's current name is the natural interface name, move the implementation into a new class and keep the old name for the interface.

## Report as

A behavior-preserving add-structure move. Name the second implementation (often the test fake) or the cycle it breaks; without one, don't recommend it. Effort scales with the number of callers whose types change.
