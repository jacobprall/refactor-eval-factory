---
refactor: replace-magic-literal
title: Replace Magic Literal
direction: add
behavior: preserving
risk: low
smells: [scattered-knowledge]
requires: []
---

# Replace Magic Literal

Give an unexplained literal (a timeout, a retry count, a limit, a threshold, a status string) a named constant, and use the name wherever the literal means the same thing. From Fowler (Replace Magic Literal, web edition of the 2nd ed.) and Beck's Explaining Constants tidying (ch. 9). Even a constant is indirection, since the reader has to jump to see the value, and added indirection is itself a cost (Beck, ch. 31). The driver is a literal that repeats with one meaning, or one whose meaning can't be read from the code around it.

## Use when

- The same value with the same meaning appears in several places, and a change must find all of them: `30000` as a request timeout, `"admin"` as a role name.
- A literal's meaning isn't evident at the site: `if (score > 0.73)`.
- Copies of what should be one value have already drifted (a 30-second timeout in one client and 3 seconds in another for the same call). Fixing that changes behavior; see Report as.

## Don't use when

- Two equal literals mean different things. `100` as a page size and `100` as a percentage stay separate; merging them couples unrelated decisions. Give each its own name, or leave them.
- The literal is self-evident in context: `0`, `1`, an empty string, a unit conversion beside a well-named variable.
- In a test, the literal is the example being checked.
- A constant for the value and meaning already exists. Use it rather than adding a second.

## Preconditions

- Every occurrence found, including other spellings of the same value (`30_000`, `30 * 1000`, `"30s"`).
- A meaning decided for each occurrence. Only occurrences with the same meaning are in scope.

## Steps

1. Search for an existing constant with this meaning, and reuse it if there is one.
2. Otherwise declare a constant named for the meaning, not the value (`REQUEST_TIMEOUT_MS`, not `THIRTY_THOUSAND`), with the unit in the name when there is one. Put it in the module that owns the concept rather than a global constants file.
3. Replace one occurrence and run the tests.
4. Replace the remaining occurrences that share the meaning, one file at a time, testing as you go.
5. For a family of related string literals (statuses, roles), use the project's enum or literal-union idiom. If the values carry rules, use [Replace Primitive with Object](replace-primitive-with-object.md) instead.

## Verify

A search finds the literal only in the constant's declaration and at occurrences with a different meaning. Tests pass. Every replaced site evaluates to the same value as before.

## Variants

- **Explaining Constants** (Beck): the tidying form, for a single literal whose meaning isn't obvious, even when it doesn't repeat.

## Report as

Behavior-preserving when every replaced occurrence had the same value. If copies had drifted, unifying them changes behavior at the outliers; list those sites and label the change. Name the value, its meaning and the sites that share it. Effort scales with the number of occurrences, and the risk is low.
