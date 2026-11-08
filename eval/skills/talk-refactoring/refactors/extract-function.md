---
refactor: extract-function
title: Extract Function
direction: add
behavior: preserving
risk: low
smells: [tangled-function, reinvented-logic, narrating-comments]
requires: []
---

# Extract Function

Move a fragment of a function into a new function named for what it does, not how it does it. The inverse is [Inline Function](inline-function.md). From Fowler (ch. 6) and Beck's Extract Helper (ch. 12), with Kerievsky's Compose Method (ch. 7), Feathers' monster-method strategies (ch. 22, 25) and Ousterhout's split criteria (ch. 9, 15). Each new function is a new interface the reader has to learn, so added indirection is itself a cost (Beck, ch. 31). Recommend the move only with a concrete driver: a repeated fragment, a block that hides a decision someone is about to change, or a function too tangled to change safely. Length alone isn't a driver.

## Use when

- A block inside a long function does one nameable thing and talks to the rest through a few values.
- A comment heads a block and says what it does; the comment can become the name.
- The same fragment appears in several places. Check first for an existing function ([Replace with Existing Function](replace-with-existing-function.md)).
- A function interleaves a high-level sequence with low-level loops, parsing or string handling.

## Don't use when

- The pieces would be conjoined: you'd have to read the helper and its caller back and forth to understand either one. Signs are a helper that takes many of the caller's locals, returns several values the caller unpacks for the next helper, or must be called in a fixed order with hidden shared state. Split elsewhere, or don't split (Ousterhout).
- You can't write a short interface comment for the new function. If describing it needs "unless" clauses or a walk through its steps, it isn't a coherent unit.
- The function is long but reads clearly top to bottom as one flat sequence.
- The existing helpers are the problem. Inline them first ([Inline Function](inline-function.md), Beck's One Pile), then re-split.

## Preconditions

- Tests covering the function. If there are none, write a [Characterization Test](characterization-test.md), or limit yourself to Extract What You Know (below) until one exists.
- The values flowing into and out of the fragment, listed. More than two or three outputs is a sign the split would be conjoined.

## Steps

1. Write the interface comment for the new function first: one or two sentences on what it does and returns. If it can't be short, stop.
2. Choose the name from that comment. If the fragment isn't contiguous, run [Slide Statements](slide-statements.md) first, as its own step.
3. Create the function and copy the fragment in. Variables it reads become parameters; a variable it assigns that the caller uses becomes the return value. Don't reorder or retype parameters while moving code (Feathers' Preserve Signatures).
4. Replace the fragment with a call. Keep the new function in the same file or class for now (Feathers: extract to the current class first).
5. Run the tests and the type checker.
6. Replace other copies of the fragment with calls, one at a time and only where edge behavior matches, testing after each.
7. Reread the caller. If you have to open the helper to follow it, inline the helper back.

## Verify

Tests pass. Each new function makes sense from its name and interface comment alone, and the caller makes sense without opening the helper. Each new function takes few parameters.

## Variants

- **Decompose Conditional** (Fowler): extract the condition and each branch of a complex conditional into named functions.
- **Compose Method** (Kerievsky): restructure a whole function into a few steps at one level of detail. It only pays off when finished.
- **Extract What You Know** (Feathers): without tests, extract only small fragments you fully understand, with few values in and out, so each step is unlikely to change behavior.
- **Find Sequences** (Feathers): extract each condition together with its body, leaving the original as a flat list of steps. Suits functions that are a series of operations.
- **Skeletonize Methods** (Feathers): extract conditions and branch bodies separately, leaving the original as a bare control structure. Suits functions whose essence is their branching. Choose this or Find Sequences.
- **Break Out Method Object** (Feathers): when the locals are too entangled to pass as parameters, move the function into its own class whose fields are the locals, then extract inside it. Adds a class, so reserve it for large functions.

## Report as

Behavior-preserving. Give the fragment, the proposed name and its one-line interface comment; that line is the evidence the unit is coherent. Effort scales with the number of values crossing the new boundary. Rank it low when the only driver is length.
