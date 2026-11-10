---
card: tangled-function
title: Tangled Function
scope: local
bundle: source
inputs: [code]
evidence: measured (causal)
also_check: [swallowed-errors, narrating-comments, toothless-tests]
refactors: [extract-function, guard-clauses, split-phase, replace-conditional-with-polymorphism, introduce-special-case, separate-query-from-modifier, sprout, characterization-test]
---

# Tangled Function

A function mixes several jobs (validation, core logic, fallbacks, logging, formatting) with deep nesting or many branches. Understanding or changing one path means holding the whole function in your head. It is the one smell with causal evidence of a lasting rise after agent adoption.

## Signals

Read this section to find candidates. If nothing here matches the code in front of you, skip the rest of the card.

- `tangled-function.brain-function`: long, branchy and nested at once: in this repo's top 10% on both length and branch count, with nesting of 3 or more. The cuts are relative to the repo, never fixed line counts.
- `tangled-function.deep-nesting`: a function with four or more nested blocks.
- `tangled-function.many-params`: a function with five or more parameters.
- `tangled-function.step-comments`: two or more `// Step 1` or `# Phase 2` section comments inside code, which mark a function doing a sequence of jobs.

Reading cues with no machine signal:

- A conditional chain that grew one branch per requirement (blame shows many small additions).
- Boolean flag parameters that switch the function between paths.
- A function that both returns a value and changes state.
- A linter's cognitive-complexity score, used as a pointer only.

## Judgment

### Confirm by

1. List the jobs the function does, in order. More than one job that could be named on its own is the core of the finding.
2. Map the paths: which branches are edge cases that could exit early, and which are variants of the main behavior.
3. Check whether the branching is inherent (a parser, a state machine) and already well named and tested. If so, stop.
4. Sketch the split and apply the conjoined-helpers guard: each extracted piece must make sense from its name alone, without reading the parent. If the pieces only make sense read together, or each one takes most of the parent's locals, the split is wrong. Try [Split Phase](../refactors/split-phase.md) instead, or leave the function alone.
5. Quote the signature and the lines where the function switches jobs, or its deepest nest.

### Not a finding

- Long but flat code: config tables, route lists, test setup, UI layout.
- Inherently branchy algorithms that are already well named and tested.
- Performance kernels written in one piece on purpose.
- Generated code.
- Length alone. A long function that does one job in a straight line is not tangled.

### Boundaries

- A catch or fallback that hides a failure belongs to [Swallowed Errors](swallowed-errors.md), even when it adds to the nesting.
- Inline clients and environment reads inside the function belong to [Hardwired Dependencies](hardwired-dependencies.md).
- Parameters that are only threaded through to a lower layer belong to [Shallow Modules](shallow-modules.md).
- Sibling functions copied and tweaked per variant belong to [Reinvented Logic](reinvented-logic.md).
- Comments that restate code belong to [Narrating Comments](narrating-comments.md). Step headers stay here, because they mark the split points.

### Also check

- [Swallowed Errors](swallowed-errors.md): defensive fallback branches are a common source of the extra nesting.
- [Narrating Comments](narrating-comments.md): step headers usually come with restating comments that can go once the function is split.
- [Toothless Tests](toothless-tests.md): tangled functions are rarely tested path by path, and restructuring needs tests that would actually fail.

### Refactors

- [Extract Function](../refactors/extract-function.md): the default. Includes Decompose Conditional for complex conditions, finding sequences for the step-by-step shape, skeletonizing for the deeply nested shape, and breaking out a method object when the pieces share many temporaries. Every extracted piece must pass the conjoined-helpers guard above.
- [Guard Clauses](../refactors/guard-clauses.md): when edge-case checks wrap the main path in nesting.
- [Split Phase](../refactors/split-phase.md): when the function runs two stages in sequence, such as parsing input and then computing on it.
- [Replace Conditional with Polymorphism](../refactors/replace-conditional-with-polymorphism.md): only for three or more variants that keep growing. Not for two stable cases.
- [Introduce Special Case](../refactors/introduce-special-case.md): when many branches handle the same "missing" case.
- [Separate Query from Modifier](../refactors/separate-query-from-modifier.md): when the function both answers a question and changes state.
- [Sprout](../refactors/sprout.md): when new behavior is due and the function can't be untangled first. Add it in a new function instead of another branch.
- [Characterization Test](../refactors/characterization-test.md): the precondition when the paths you will restructure have no tests.

## Evidence

Measured, causal. After Cursor adoption, cognitive complexity rose 40.7% and static-analysis warnings 29.7%, and both stayed high (He et al. v2; difference-in-differences over 807 adopting and 1,380 control repos; the later v3 reports about 41% and 30% on 806 repos). Agent adoption raised complexity about 35% in agent-first repos and 43% in IDE-first repos (Agarwal et al.). Cognitive complexity (Sonar rule S3776, 157 cases) is the second most violated rule in merged agent bug-fix PRs (Cynthia et al.; no human baseline).

## Aliases

Long Function (Fowler ch. 3), Brain Method (Lanza & Marinescu), Monster Method in its Bulleted and Snarled shapes (Feathers ch. 22), Long Method and Conditional Complexity (Kerievsky ch. 4), complexity inflation (agent-code research), part of Nonobvious Code (Ousterhout ch. 18).
