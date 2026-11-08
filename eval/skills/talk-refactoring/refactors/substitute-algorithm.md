---
refactor: substitute-algorithm
title: Substitute Algorithm
direction: reshape
behavior: preserving
risk: medium
smells: [inconsistent-solutions, reinvented-logic]
requires: [characterization-test]
---

# Substitute Algorithm

Replace an implementation with a clearer one that produces the same results, and when the codebase does one thing several ways, converge every variant on one chosen way and delete the others. From Fowler's Substitute Algorithm (ch. 7) and Beck's Normalize Symmetries (*Tidy First?* ch. 3), with Kerievsky's Unify Interfaces with Adapter (*Refactoring to Patterns* ch. 8) as a temporary migration path.

## Use when

- One concern (HTTP calls, error reporting, config loading, dates, retries) is handled with two or more mechanisms or libraries in the same layer.
- Several idioms for the same operation coexist (different lazy-initialization styles, mixed null-check styles), so readers must check whether each difference means something.
- A convoluted implementation can be replaced by a simpler one, often after it has been broken into pieces.

## Don't use when

- The variants differ in semantics that matter: thread safety, error behavior, performance, protocol.
- A migration is already underway. The finding becomes "finish the migration" with the existing target.
- The difference sits at a real boundary (another protocol needs another client).
- The replacement is an existing function. Use [Replace with Existing Function](replace-with-existing-function.md) instead.

## Preconditions

- The target way chosen: the dominant local idiom, unless the user chooses otherwise. Use git to see which idiom is newer when that matters.
- The code being replaced isolated in one function, if it isn't already ([Extract Function](extract-function.md) first).
- A [Characterization Test](characterization-test.md) of each variant being retired, if none exists, including edge and failure cases.

## Steps

1. Write or confirm tests that pin the current results of the variant you will replace.
2. Write the replacement using the chosen way, next to the old code.
3. Run the tests against both, comparing results on the same inputs. Investigate every difference before going on.
4. Switch callers to the replacement, testing after each batch.
5. Delete the old implementation with [Remove Dead Code](remove-dead-code.md). Remove a library from the dependency list once nothing imports it.
6. Repeat for each other variant until one way remains.
7. Optionally record the chosen convention in the project's agent instructions file so new code follows it.

## Verify

One mechanism remains for the concern, the tests pass unchanged, and the retired library or helper has no remaining imports.

## Variants

- **Normalize Symmetries** (Beck): pick one form for code that does the same thing and convert the rest, so a difference in form signals a difference in meaning.
- **Unify Interfaces with Adapter** (Kerievsky): when two classes do the same job behind different interfaces and callers can't all switch at once, adapt the oddball to the preferred interface, migrate callers, then remove the adapter and the oddball. The adapter temporarily adds structure; the card is only finished when it is gone.

## Report as

A reshape that saves readers from learning and checking several ways of doing one thing. Name each variant, the chosen target and why it won. Medium risk, because variants that look alike can differ in edge behavior; effort scales with the number of call sites per variant. If an adapter is used, say it is temporary and list the step that removes it.
