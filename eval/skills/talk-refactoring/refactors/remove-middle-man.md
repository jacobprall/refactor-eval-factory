---
refactor: remove-middle-man
title: Remove Middle Man
direction: remove
behavior: preserving
risk: low
smells: [shallow-modules]
requires: []
---

# Remove Middle Man

When a class or layer mostly forwards calls to another, let clients call the lower layer directly and delete the forwarding methods. The inverse of Hide Delegate. From Fowler's Remove Middle Man (ch. 7) and Ousterhout's advice to expose the lower layer when a pass-through method adds nothing (§7.1).

## Use when

- Most methods on a class are one-line forwards with the same or renamed arguments.
- Adjacent layers have mirrored signatures (controller, service, repository) and the middle one adds no validation, translation or policy.
- Each new feature requires adding a matching forwarding method at every layer.

## Don't use when

- The middle layer is a dispatcher that chooses among implementations.
- It is a decorator that adds real behavior: auth, caching, retries, logging, metrics.
- It is a deliberate boundary: a public facade over internals, an anti-corruption layer, or a test seam with a real fake.
- Clients would then reach through a long chain of objects to get what they need. Some forwarding is cheaper than that coupling.

## Preconditions

- Every caller of each forwarding method found (map importers, then a search for the method name).
- A way for clients to get the delegate: an existing accessor, or one you add in step 1.

## Steps

1. If clients can't reach the delegate, add an accessor on the middle class that returns it, or pass the delegate to clients directly.
2. Pick one forwarding method. Change each of its callers to call the delegate instead. Run the tests.
3. Delete the forwarding method once it has no callers. Run the tests.
4. Repeat for the other forwarding methods.
5. If the middle class is now empty or holds only the accessor, remove it with [Inline Class](inline-class.md).

## Verify

Callers use the lower layer directly, the deleted methods have no remaining references, and the tests pass unchanged. No new call chain longer than one hop was introduced.

## Variants

- **Expose the lower layer** (Ousterhout): when a whole layer passes through, remove the layer rather than its methods one by one.
- **Partial removal**: keep the forwarding methods that add something and remove only the pure pass-throughs. The class then shows which parts of its interface are real.
- **Give the layer real work instead**: if the layer should stay, use [Move Function](move-function.md) to move logic into it so it stops being shallow.

## Report as

A structure removal that saves one hop per call and one method per feature at that layer. Name the middle class, how many of its methods only forward, and what clients will call instead. Effort scales with the number of callers.
