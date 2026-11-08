---
card: narrating-comments
title: Narrating Comments
scope: local
bundle: source
inputs: [code, git]
evidence: weak measured + practitioner
also_check: [tangled-function, dead-code]
refactors: [delete-redundant-comments, extract-function, change-function-declaration, introduce-assertion]
severity_cap: low
---

# Narrating Comments

Comments that restate the next line, narrate the edit that produced the code ("now uses X instead of Y"), or walk through internals in an interface docstring. They cost reading time, go stale as soon as the code changes, and often mark a function that wants splitting. Severity is capped at low: they are cheap to fix and cost little to keep.

## Signals

Read this section to find candidates. If nothing here matches the code in front of you, skip the rest of the card.

- `narrating-comments.restating-comment`: comments that restate the next line (`// Create the client`, `# Loop through users`, `// Return the result`), three or more in a file.
- `narrating-comments.change-narration`: comments that describe the edit rather than the code ("now uses", "no longer", "refactored", "replaced with", "moved from").
- `narrating-comments.comment-dense-file`: a file whose share of comment lines is in the repo's top 10% and at least 25%.

Reading cues with no machine signal:

- A comment whose words mostly repeat the identifiers beside it (`// get user name` above `getUserName()`).
- Interface docstrings that describe algorithm steps, private helpers or internal data structures ("First we..., then we...").
- Docstrings that only expand the function name and parameter list.
- Docstrings added in a diff to functions the change didn't otherwise touch (git).
- `// Step 1`, `// Step 2` section headers inside a function. Route these to [Tangled Function](tangled-function.md).

## Judgment

### Confirm by

1. Delete the comment in your head and reread the code. If nothing is lost, it narrates.
2. Check what the comment adds: a reason, a constraint, a unit, a range, an issue link, a warning. Any of those makes it worth keeping, perhaps reworded.
3. For change narration, check whether the "before" state appears anywhere in the code. It usually doesn't; the comment describes history that belongs in the commit message.
4. For interface docs, separate what a caller needs (behavior, errors, side effects, cost, thread safety) from how it is done. The "how" part is the finding.
5. Quote the comment and the line or signature it repeats.

### Not a finding

These are protected. Never recommend deleting them:

- Comments that explain why: a business reason, a rejected alternative, a link to an issue or spec.
- Comments that state an invariant, precondition, unit or range (`// cents, not dollars`, `// must be sorted`, `// inclusive`).
- Comments that warn of a hazard (`// not thread-safe`, `// X must run before Y`, a workaround for an upstream bug).
- Public API documentation required by tooling or convention, as long as it describes behavior rather than internals.
- Teaching code, examples and tutorials.
- License headers and tool directives (`// eslint-disable-next-line`, `# type: ignore`).

### Boundaries

- `// Step N` or `# Phase N` headers inside a function belong to [Tangled Function](tangled-function.md). The fix there is extraction, not deletion.
- Commented-out code belongs to [Dead Code and Leftovers](dead-code.md).
- A comment naming a specific test ("special case for test_x") is evidence for [Toothless Tests](toothless-tests.md), not a narrating comment.

### Also check

- [Tangled Function](tangled-function.md): blocks headed by comments are often separate jobs packed into one long function.
- [Dead Code and Leftovers](dead-code.md): change narration ("old version below", "no longer used") often sits next to the code it calls obsolete.

### Refactors

- [Delete Redundant Comments](../refactors/delete-redundant-comments.md): the default. Delete comments that restate code or narrate history. Where real rationale is missing, replace the narration with a short comment that says why.
- [Extract Function](../refactors/extract-function.md): when a comment heads a block that does one job. The comment becomes the function's name.
- [Change Function Declaration](../refactors/change-function-declaration.md): when a comment explains what a badly named function or variable means. Rename it and delete the comment.
- [Introduce Assertion](../refactors/introduce-assertion.md): when the comment states an assumption the code could check (`// items is never empty here`).

## Evidence

Weak measured plus practitioner. After agent adoption, comment-line density rose about 22% in repos that already used AI IDEs; in agent-first repos the effect was small and not significant (Agarwal et al.). In Sonar's benchmark, comment density ranged from 2.1% to 16.4% depending on the model. Anthropic tells its models not to add comments or docstrings to code they didn't change. That the added comments mostly narrate rather than explain is a hypothesis; no study classifies comment content.

## Aliases

Comments as deodorant (Fowler ch. 3), Comment Repeats Code and Implementation Documentation Contaminates Interface (Ousterhout ch. 13), the target of Delete Redundant Comments (Beck ch. 15), redundant or noise comments (Clean Code), excess or narrating comments (agent-code research).
