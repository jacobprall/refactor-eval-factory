---
refactor: delete-redundant-comments
title: Delete Redundant Comments
direction: remove
behavior: preserving
risk: low
smells: [narrating-comments]
requires: []
---

# Delete Redundant Comments

Delete comments that say only what the code already plainly says, and where there is a reason worth recording, replace the restating comment with one that explains it. From Beck's Delete Redundant Comments (*Tidy First?* ch. 15), with his Explaining Comments (ch. 14) as the replacement variant, and Ousterhout's rule that comments should describe what isn't obvious from the code (ch. 13).

## Use when

- A comment paraphrases the next line (`// increment the counter`, `// return the result`).
- A docstring only expands the identifier and parameter names.
- A comment narrates the edit history ("now uses X instead of Y", "updated to fix the bug").
- An interface docstring walks through the implementation step by step.

## Don't use when

- The comment explains why, states an invariant or a unit, or warns of a hazard.
- It is public API documentation required by tooling or consumers. Rewrite it to add precision instead of deleting it.
- The code is teaching or example code where narration is the point.
- A `// Step 1`, `// Step 2` comment heads a block in a long function. That is a [Tangled Function](../smells/tangled-function.md); use [Extract Function](extract-function.md) and let the name replace the comment.

## Preconditions

- None for deletion; comments don't change behavior. Read the surrounding code first to make sure the comment isn't the only record of a real reason.

## Steps

1. For each comment, ask whether a reader would lose any information if it were gone.
2. If not, delete it.
3. If the comment hints at a reason (a workaround, an ordering constraint, a coupling to another module), replace it with a short comment that states that reason directly.
4. If the comment exists because a name is unclear, rename instead with [Change Function Declaration](change-function-declaration.md) and delete the comment.
5. If the comment states a condition that must hold, consider [Introduce Assertion](introduce-assertion.md).
6. Keep comment edits in their own commit, separate from code changes.

## Verify

The diff touches only comments (plus any rename), the tests pass, and every remaining comment tells the reader something the code doesn't.

## Variants

- **Explaining Comment** (Beck): replace a restating comment with one that records the non-obvious reason behind the code, such as a hidden coupling or why the obvious approach was not used.
- **Move implementation notes out of interface docs** (Ousterhout): keep what and why in the docstring, and move how into comments inside the body, or delete it.

## Report as

A low-risk removal that saves reading time and a comment that will go stale. Group findings per file rather than per comment. Effort is small; say which comments were rewritten rather than deleted.
