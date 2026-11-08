---
name: refactoring
description: Improve change locality with small behavior-preserving structural changes.
---

# Refactoring for change locality

Refactoring changes structure without changing observable behavior. Use it only when a concrete requested change exposes costly propagation. A clean-looking file is not sufficient evidence.

## Decision rule

1. Describe the requested behavior and predict the smallest implementation change set.
2. Identify elements that must change only because one decision is duplicated, scattered, or exposed through the wrong interface.
3. Choose at most one small refactor that reduces those required edits.
4. If behavior is not protected, add a characterization test first.
5. Apply and verify the structural change before changing behavior.
6. Skip the refactor when its cost or risk exceeds the concrete locality benefit.

## Common signals and moves

- Repeated logic or parallel helpers: replace with an existing function, then extract or combine only when the shared concept is real.
- One policy encoded in several modules: move the policy behind one existing seam or extract a focused module.
- A change requires edits in unrelated branches of a large function: split phase, extract function, or use guard clauses.
- Callers know implementation details: change the function declaration, move the function, or wrap the dependency.
- A pass-through layer adds no leverage: inline it or remove the middle man.
- Errors become defaults or silence: narrow error handling without altering successful behavior.
- Tests assert implementation details: assert observable outcomes; prefer a fake over broad mocking when it improves the seam.

## Guardrails

- Do not create flexibility for hypothetical future requirements.
- Do not rename or rearrange code without a concrete reduction in change propagation.
- Do not combine structural and behavioral edits.
- Do not weaken tests, suppress checks, or raise thresholds.
- Do not spread one change across more abstractions merely to satisfy a size metric.
- Long, flat code is not automatically tangled; a layer is not automatically useful.
