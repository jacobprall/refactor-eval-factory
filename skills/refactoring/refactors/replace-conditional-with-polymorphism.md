---
refactor: replace-conditional-with-polymorphism
title: Replace Conditional with Polymorphism
direction: add
behavior: preserving
risk: medium
smells: [scattered-knowledge, tangled-function]
requires: [characterization-test]
---

# Replace Conditional with Polymorphism

When code switches on a type, kind or mode to choose behavior, and the switch repeats or keeps growing, give each case its own implementation (a class, a strategy, or an entry in a table of handlers) so that adding a case means adding one thing in one place. To back out, use [Inline Class](inline-class.md) and its Collapse Hierarchy form. From Fowler (ch. 10) and Kerievsky's pattern-directed forms (ch. 7). This adds an interface, a factory and one unit per case, and added indirection is itself a cost (Beck, ch. 31). Kerievsky warns that reaching for a pattern where a conditional would do is over-engineering (ch. 1). The driver must be a repeated switch or a stream of new cases.

## Use when

- The same `switch` or `if` chain on one tag (`type`, `kind`, `status`, `provider`) repeats across functions or files, and adding a case means finding every copy.
- One conditional has grown a branch per feature, each with substantial logic, and new cases keep arriving.
- A long chain routes a command or request name to inline actions.

## Don't use when

- There are two stable cases, or a few in one place. A plain conditional is clearer (Kerievsky).
- The switch appears once, at a boundary (a parser or factory) that turns raw input into types. That is where a switch belongs.
- The cases differ only in a value. Use [Parameterize Function](parameterize-function.md).
- Only one case exists and the others are imagined. That would create [Speculative Generality](../smells/speculative-generality.md).

## Preconditions

- A [Characterization Test](characterization-test.md) covering every case of every copy of the switch, plus an unknown tag.
- All copies found, by searching for the tag's literal values.

## Steps

1. Pick the form (see Variants). Use classes in object-oriented code and a handler table in functional code, matching any form the codebase already uses.
2. Define the shared interface or table type, and a factory or lookup that maps a tag to its implementation. This becomes the only remaining switch. Run tests.
3. Route one switch's callers through the lookup, with every implementation initially falling back to the existing conditional. Run tests.
4. Move one case's branch into its own implementation and delete that branch from the conditional. Run tests. Repeat per case.
5. Repeat steps 3 and 4 for each other copy of the switch.
6. Delete the emptied conditionals. Keep the old default behavior for unknown tags (an error or a fallback) in the lookup.
7. Run the full test suite.

## Verify

A search for the tag literals finds them only in the lookup and in tests. Adding a case would touch one new unit or one table entry, plus the lookup. Unknown tags behave as before.

## Variants

- **Replace Conditional Logic with Strategy** (Kerievsky): when the conditional picks a variant of one calculation, delegate it to a strategy object chosen by a factory or the caller.
- **Replace Conditional Dispatcher with Command** (Kerievsky): when a conditional routes requests by name to inline actions, make each action a command in a map, and replace the conditional with lookup and execute.
- **Replace State-Altering Conditionals with State** (Kerievsky): when conditionals read and assign a status field to drive transitions, make each state an object that handles its own transitions.
- **Handler lookup table** (skill-defined): the functional-code form. A map from tag to function, typed so the checker reports a missing case (a `Record<Kind, Handler>` in TypeScript, a dict keyed by an enum with an exhaustiveness test in Python).

## Report as

Behavior-preserving. Name the tag, the number of switches that repeat it and the number of cases; with fewer than three stable cases, don't recommend it. Effort scales with copies times cases. Where a class hierarchy and a handler table would both work, recommend the table.
