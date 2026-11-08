---
card: scattered-knowledge
title: Scattered Knowledge
scope: cross
bundle: map
family: duplication
inputs: [code, map, git]
evidence: hypothesis + measured* (no baseline)
also_check: [reinvented-logic, import-tangle, overloaded-module]
refactors: [move-function, extract-module, combine-functions, replace-primitive-with-object, replace-conditional-with-polymorphism, replace-magic-literal, split-phase, inline-function, inline-class, slide-statements]
---

# Scattered Knowledge

One design decision (a format, a business rule, a type code and its cases, a protocol detail) is encoded in several modules. One logical change then needs coordinated edits in all of them, and missing one is a bug.

## Signals

Read this section to find candidates. If nothing here matches the code in front of you, skip the rest of the card.

- `scattered-knowledge.co-change`: files in different modules that keep changing in the same commits, from git history. The sharpest signal on this card, but only after mechanical sweeps are filtered (see Confirm by).
- `scattered-knowledge.repeated-literal`: the same string literal in three or more source files across modules (the 40 most widespread are reported).
- `scattered-knowledge.switch-on-kind`: branching on a `type`, `kind`, `status`, `role` or similar field, reported when it appears three or more times.

Reading cues with no machine signal:

- Two modules that parse or build the same format.
- A high fan-in file that co-changes with many others.
- Modules named after plan steps (`reader`, `processor`, `writer`) that all know the same format.
- A primitive (an ID string, money as a number, a status string) whose validation rules repeat at several sites.

## Judgment

### Confirm by

1. State the decision in one sentence: "the order status values and what each one allows", "the CSV column layout".
2. Find every site that encodes it: search for the literal, the kind values, or the format's field names, and use the map to see which modules they sit in.
3. For co-change pairs, filter mechanical sweep commits before trusting the count: formatting runs, lint fixes, renames, license headers, dependency bumps, codemods. Recon drops very large commits and obviously named ones, not all of them. Then read two or three of the remaining shared commits and check that the same decision changed in both files.
4. Check whether a single owner already exists that the sites could call. If one exists and is bypassed, part of the finding is [Reinvented Logic](reinvented-logic.md).
5. Quote two sites that would need the same edit for one logical change, and name a commit that shows they did.

### Not a finding

- Co-change that comes only from mechanical sweeps.
- A field that legitimately appears in the DTO, the schema and the UI. Note the cost, at low priority.
- A published wire contract that both sides validate on purpose.
- A single switch in a factory or parser at a boundary.
- Equal literals with different meanings (`"pending"` in two unrelated state machines). Merging them couples things that should vary independently.
- Files that co-change because one is generated from the other.

### Boundaries

- The same behavior implemented twice belongs to [Reinvented Logic](reinvented-logic.md). This card is one decision spread across sites, even when each site's code differs.
- Co-change explained by an import cycle or bidirectional imports belongs to [Import Tangle](import-tangle.md).
- Repeated literals inside test setup belong to [Bloated Test Setup](bloated-test-setup.md).
- One long, nested switch inside a single function belongs to [Tangled Function](tangled-function.md).

### Also check

- [Reinvented Logic](reinvented-logic.md): scattered rules are often copies of one function that drifted apart.
- [Import Tangle](import-tangle.md): giving the knowledge one owner changes who imports whom and can create or break a cycle.
- [Overloaded Module](overloaded-module.md): the obvious owner may already be a grab-bag; don't pile more into it.

### Refactors

- [Move Function](../refactors/move-function.md): when one module already owns most of the decision. Includes moving fields.
- [Extract Module](../refactors/extract-module.md): when no existing module should own it and the decision needs a new home.
- [Combine Functions](../refactors/combine-functions.md): when several functions across modules compute from the same data.
- [Replace Primitive with Object](../refactors/replace-primitive-with-object.md): when a primitive's rules repeat at several sites. Includes replacing a type code with a class.
- [Replace Conditional with Polymorphism](../refactors/replace-conditional-with-polymorphism.md): when the same switch on kind repeats in three or more places and the cases keep growing. A lookup table counts.
- [Replace Magic Literal](../refactors/replace-magic-literal.md): when a repeated literal has one meaning everywhere it appears.
- [Split Phase](../refactors/split-phase.md): when parsing a format is interleaved with processing it at several sites.
- [Inline Function](../refactors/inline-function.md) and [Inline Class](../refactors/inline-class.md): when gathering the knowledge means merging plan-step modules back together.
- [Slide Statements](../refactors/slide-statements.md): a cheap partial step that groups the related code before it moves.

## Evidence

Hypothesis for agents: it is the expected downstream effect of the measured duplication described in [Reinvented Logic](reinvented-logic.md). The literal form is measured without a baseline: duplicated string literals (Sonar rule S1192, 212 cases) were the most violated rule in merged agent bug-fix PRs (Cynthia et al.). The non-agent cost is measured: files caught in co-change hotspot patterns are more bug- and change-prone (Mo et al.). Mo et al. use four co-changes as an example threshold; recon defaults to three, and both are tunable.

## Aliases

Shotgun Surgery (Fowler ch. 3; Lanza & Marinescu), Information Leakage (Ousterhout ch. 5), Temporal Decomposition as a cause (Ousterhout ch. 5), Solution Sprawl (Kerievsky ch. 4), Repeated Switches (Fowler) or Switch Statements (Kerievsky), Primitive Obsession where the rules repeat (Fowler; Kerievsky), Missing Abstraction, Missing Encapsulation and Unexploited Encapsulation (Suryanarayana), Implicit Cross-module Dependency and Unstable Interface (Mo et al.), Scattered Parasitic Functionality (Garcia et al.), duplicated string literals (agent-code research).
