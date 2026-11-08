---
card: misleading-interface
title: Misleading Interface
scope: cross
bundle: map
family: abstraction
inputs: [code, map]
evidence: practitioner + hypothesis
also_check: [shallow-modules, swallowed-errors, hardwired-dependencies]
refactors: [change-function-declaration, separate-query-from-modifier, combine-functions]
---

# Misleading Interface

A function, method, type or field whose name and signature hide behavior a caller must know: it writes to an external system, checks ownership, cancels something, rewrites a whole record, throws to end the caller's work, or must be called in a certain order. A caller who reads only the signature will misuse it. Agents produce this when they reuse whatever method already has the effect they need, so the code works but no longer reads as what it does.

## Signals

Read this section to find candidates. If nothing here matches the code in front of you, skip the rest of the card.

- `misleading-interface.self-reinvoke`: a method that calls another public method of the same object with that object's own field (`this.progress(this.#summary)`), which usually means the call is made only for its side effect.
- `misleading-interface.query-name-writes`: a function named like a question or a read (`get`, `is`, `has`, `find`, `read`, `check`, `can`, `should`) whose body writes: it sets fields, saves, sends, deletes or posts.
- `misleading-interface.flag-parameter`: two or more functions in a module that take a positional boolean parameter, so call sites read `doThing(x, true)`.
- `misleading-interface.name-doc-mismatch`: from the model pass over `map.md`. An export whose doc line describes I/O, cancellation, authority or a state change that its name doesn't suggest.

Reading cues with no machine signal:

- A method named like a local operation (`record`, `track`, `open`, `progress`) that makes network or database calls.
- An error class that doesn't fail the operation it is thrown from, or a "failure" result that the framework reports as success.
- An optional field whose default changes what the result means.
- A behavior switch the caller never passes (a mode read from context, metadata or a global).
- A parameter typed as a large object when the function uses one field.
- A `find`, `get` or `create` that also updates what it finds.
- Exports that are internal primitives but sit in the module's public entry next to the intended API.

The most-imported exports in `map.json` (`files[].exports[].importers`) and modules that the project's docs point extension authors at are where this smell costs the most. Start there.

## Judgment

### Confirm by

1. **The call-site test.** Read only the signature, its doc line and one call site. Write down in one line what you expect the call to do.
2. Read the body and everything it calls that has an effect. List each behavior a caller would need to know that your line didn't predict: external writes, ownership checks, cancellation, thrown control flow, whole-object rewrites, required order, implicit modes, changed defaults.
3. Keep only mismatches that could cause a real mistake: a caller skipping a needed call, calling it twice, catching the wrong thing, or reading a result wrongly. Write the mistake down.
4. Check that a rename alone would fix it. If the behavior itself is the problem (an error that doesn't fail), the fix is a redesign, and this is a question for the report, not a rename.
5. Quote the signature, the call site, and the line in the body that does the unexpected thing.

### Not a finding

- The return type already says it (a function returning collected results doesn't need "collect" in its name).
- The module or class already disambiguates a short name (`publish` inside a changeset module).
- A conventional verb for acquiring a managed resource (`open`, `connect`, `create`), even when the work behind it is heavy.
- A default that matches the common case when the uncommon case goes through another mechanism (success defaults to "done" because failures throw).
- A rename that doesn't change the mental model. Swapping one vague word for another is churn.
- Internal primitives exposed in a public entry point: the fix is to stop exporting them, not to rename each one. Report it as one finding about the public surface.

### Boundaries

- A layer that only forwards belongs to [Shallow Modules](shallow-modules.md); this card is about layers that do more than their name says.
- A side effect hidden because a collaborator is constructed inside belongs to [Hardwired Dependencies](hardwired-dependencies.md).
- A catch that hides a failure belongs to [Swallowed Errors](swallowed-errors.md). An error type whose name says "failure" but which ends the task successfully belongs here.
- A comment that narrates what the code does belongs to [Narrating Comments](narrating-comments.md). A doc line that is the only place a hidden behavior is mentioned is evidence for this card.

### Also check

- [Shallow Modules](shallow-modules.md): the same public surface often has wrappers that add nothing next to methods that do too much.
- [Swallowed Errors](swallowed-errors.md): control flow by exception and errors that don't fail usually sit near catches that turn failures into results.
- [Hardwired Dependencies](hardwired-dependencies.md): hidden I/O often comes from a client the method reaches for itself.

### Refactors

- [Change Function Declaration](../refactors/change-function-declaration.md): the default. Rename so the verb states the effect (`reportProgress`, `trackSandbox`, `assertCurrent`, `ensurePull`), narrow parameters to what is used (`{ id: string }`), remove a flag argument by splitting the function, or stop exporting internal primitives. Rename one coherent surface at a time (every method of one class), not single names across the codebase.
- [Separate Query from Modifier](../refactors/separate-query-from-modifier.md): when a function named like a read also writes. Split it so the read is safe to call.
- [Combine Functions into Class / Transform](../refactors/combine-functions.md): when several methods each rewrite part of one external record. Keep one state snapshot that every method updates and publishes, so no update drops another's field.

## Evidence

Practitioner and hypothesis. Ousterhout argues that code should be obvious and that a name should create the right image in a reader's mind; Fowler's Separate Query from Modifier and Remove Flag Argument target the same confusion. A review of the agent-written software-factory template found a method reused only to republish its side effect, an ownership check named like a save, and an upsert named like a lookup. Reviewers of Claude Code pull requests spent about half of their revisions on style and structure fixes (Watanabe et al.), which is consistent with this smell but doesn't measure it. Human raters agree poorly on naming smells in general (Mäntylä), so this card keeps only mismatches that cause a concrete mistake.

## Aliases

Nonobvious Code, Vague Name and Hard to Pick Name (Ousterhout ch. 14 and 18), Mysterious Name (Fowler ch. 3, its behavior-hiding case only), Flag Argument (Fowler, Remove Flag Argument), Undetectable Side Effect (Feathers ch. 10), command-query separation (Meyer, via Fowler).
