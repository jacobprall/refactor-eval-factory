---
refactor: combine-functions
title: Combine Functions into Class / Transform
direction: add
behavior: preserving
risk: medium
smells: [scattered-knowledge, reinvented-logic, misleading-interface]
requires: [characterization-test]
---

# Combine Functions into Class / Transform

When several functions take the same record and compute things from it, gather them in one place: group them with the data in a class, or write one transform that takes the source data and returns an enriched copy carrying every derived value. Knowledge of how those values are derived then has a single owner. From Fowler (ch. 6). A new class or transform is one more thing to learn and pass around, and added indirection is itself a cost (Beck, ch. 31). The driver must be concrete: a derivation that is repeated, or one that has already been missed when its rule changed.

## Use when

- The same derived value (a total, a display name, an "is overdue" flag) is computed from the same record in several places.
- A family of free functions all take the same object as their first argument and are used together.
- A change to how one derived value is computed has missed a site before, per bug history or co-change in git.

## Don't use when

- The functions only share an argument type and use different parts of it for unrelated reasons.
- The derivation has one or two sites and isn't changing.
- The class form would only add getters over a record with no rules, which is a shallow wrapper.
- The transform form would be applied to data that is mutated afterwards, so the enriched copy goes stale. Use the class form or leave it.

## Preconditions

- A [Characterization Test](characterization-test.md) covering each derived value at its current sites.
- Every copy of each derivation compared for edge semantics: rounding, nulls, time zones, empty collections. Copies that disagree are a finding to settle with the owner, not something to merge silently.

## Steps

1. Pick the form (see Variants) and match the codebase's idiom.
2. Class form: wrap the record in a class, using [Encapsulate Variable](encapsulate-variable.md) first if it is shared module state. Move the functions in one at a time ([Move Function](move-function.md)), testing after each.
3. Transform form: write a function that deep-copies the source record and returns it. Run tests. Move one derivation into it as a new field and switch one call site to read that field. Run tests. Repeat per derivation.
4. Replace each remaining copy of a derivation elsewhere with the method or field, one site at a time, testing after each.
5. Delete the old free functions once nothing calls them ([Remove Dead Code](remove-dead-code.md)).
6. Run the full test suite.

## Verify

A search for each derivation's distinctive expression finds it only in the new home. Tests pass. With the transform form, the source record is unchanged after the call.

## Variants

- **Combine Functions into Class** (Fowler): suits data that is updated over time, or object-oriented code. The class can also guard updates to the data.
- **Combine Functions into Transform** (Fowler): suits data that is read-only once built, and functional or pipeline-shaped code. Often the first phase of a [Split Phase](split-phase.md).
- **One state snapshot**: when several methods each rewrite part of one external record (a status comment, a document, a row), keep the record as one private snapshot. Each public method applies a narrow update (`{ summary }` or `{ sandboxId }`, not an arbitrary partial) and publishes the whole snapshot through one private method, so no update drops another's field and no method is reused just for its side effect.

## Report as

Behavior-preserving when every copy of a derivation already agrees. If they disagree, merging changes behavior at the outlying sites; list them and label the change. Name the record, the derived values and the sites that repeat them. Effort scales with the number of call sites.
