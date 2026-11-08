---
refactor: introduce-assertion
title: Introduce Assertion
direction: reshape
behavior: changes-failure-paths
risk: low
smells: [swallowed-errors, narrating-comments]
requires: []
---

# Introduce Assertion

State an assumption the code already relies on as an assertion, so a violation fails at the point it happens instead of producing a wrong result further on. It replaces a comment that states the assumption, or a defensive check or fallback for a case that can't happen. If the assumption holds, nothing changes. If it doesn't, code that used to carry on silently now stops, which is why the card is labeled as changing failure paths. From Fowler (ch. 10).

## Use when

- A comment states an invariant: "`items` is never empty here", "only called after `init`".
- A `?.`, a `?? default` or a catch guards a state that the types or the call graph say is impossible.
- A bad value would travel far from its cause before anything noticed.

## Don't use when

- The condition can actually happen: user input, network responses, file contents, anything across the system boundary. That needs validation and a real error.
- The type system can carry the assumption (a non-null type, a narrower parameter type). Prefer the type.
- The check is expensive on a hot path, such as scanning a large collection.
- The assertion would only restate what the next line or the type checker already guarantees. That is noise.

## Preconditions

- Evidence that the condition holds: the types, the callers (the map's importers, then a search for the name), or the boundary that already validated it.
- When the assertion replaces an existing catch, fallback or default, a [Characterization Test](characterization-test.md) of that path, as for [Narrow Error Handling](narrow-error-handling.md).

## Steps

1. Write the assumption as one sentence and find where it is established (the boundary check, the constructor, the caller).
2. Add the assertion where the code starts relying on it, with a message that names the assumption. Use the project's existing idiom (`assert`, `invariant()`, `debug_assert!`, a thrown error). If the check must run in production, use an explicit throw, since some runtimes strip `assert` (Python with `-O`).
3. Run the tests. A failure means the assumption was wrong: stop and report it as a bug rather than weakening the assertion.
4. Remove the comment or fallback the assertion replaces, in the same step.
5. Run the full test suite.

## Verify

Tests pass with the assertion in place. A test that feeds the impossible value fails at the assertion, with its message, instead of returning a default.

## Report as

When it replaces a fallback, a change on failure paths: the impossible case now stops instead of continuing. Quote the evidence that the case can't happen. Effort is small. Raise the risk to medium when the removed default used to flow on to callers or users.
