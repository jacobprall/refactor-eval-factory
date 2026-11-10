---
refactor: split-phase
title: Split Phase
direction: add
behavior: preserving
risk: medium
smells: [tangled-function, overloaded-module, scattered-knowledge]
requires: [characterization-test]
---

# Split Phase

Divide code that does two things in sequence (parse then compute, compute then format, gather then decide then write) into separate phases joined by an explicit intermediate data structure. Each phase can then change and be tested without the other. There is no named inverse; to undo it, inline the phases back together. From Fowler (ch. 6). The move adds a type and a boundary, and added indirection is itself a cost (Beck, ch. 31). It needs a concrete driver: changes that keep landing on one side, a second entry point that repeats the logic, or a core computation that can't be tested without the raw input.

## Use when

- A handler mixes reading input (request parsing, file reading, raw API response shapes) with business logic and output formatting.
- Changes to the input format and changes to the calculation keep landing in the same function.
- Several entry points (CLI, HTTP handler, background job) each parse their own input and then repeat the same logic. One shared second phase removes the copies.
- The core computation can't be tested without building the raw input or capturing the output.

## Don't use when

- Both phases need the same format knowledge, so it would leak into the intermediate structure. Splitting by order of execution rather than by knowledge spreads one decision across both sides (Ousterhout's temporal decomposition, ch. 5).
- The function is short, one input feeds one output, and no change is pending on either side.
- The intermediate structure would just be the raw input under a new name.

## Preconditions

- A [Characterization Test](characterization-test.md) of the whole function: input in, output or effects out.
- A boundary point after which nothing reads the raw input. If none exists yet, [Slide Statements](slide-statements.md) must be able to create one.

## Steps

1. Find the boundary. Slide statements so all first-phase work comes before it. Run tests.
2. Extract the code after the boundary into a second-phase function ([Extract Function](extract-function.md)), passing what it currently reads. Run tests.
3. Introduce the intermediate structure as a plain record or type, initially empty, and pass it to the second phase as an extra argument. Run tests.
4. One at a time, replace each raw-input value the second phase reads with a field on the intermediate structure, filled in by the first phase. Run tests after each.
5. When the second phase reads only the intermediate structure, extract the first phase into a function that returns it.
6. Add a test for the second phase that builds the intermediate structure directly.
7. Run the full test suite.

## Verify

The second phase's signature mentions the intermediate structure and its own dependencies, never the raw input type. The characterization test still passes. Renaming an input field touches only the first phase.

## Report as

Behavior-preserving. Name the two phases, the boundary line and the fields of the intermediate structure, plus the driver (the pending change or repeated entry point). Effort scales with how interleaved the phases are and how many fields cross the boundary. Medium risk, higher when the first phase has side effects the second relies on happening first.
