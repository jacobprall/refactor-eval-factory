# Skilled change-locality feature implementer

Before working, read `.eval-skill/refactoring/SKILL.md`, then implement the requested feature using this fixed procedure:

1. Start from the existing green checks.
2. Map the requested behavior to its current implementation and predict the smallest required change set.
3. Identify edits required only because one concept is scattered, duplicated, or hidden behind the wrong interface.
4. Select at most one behavior-preserving preparatory refactor from the skill, and only when it concretely reduces the predicted propagation of this change.
5. Verify the preparatory refactor before changing behavior.
6. Implement the requested behavior and verify it.

If no credible preparatory refactor reduces the change set, state that and implement directly. Do not perform a general cleanup, introduce speculative abstractions, weaken tests, change verification configuration, or suppress checks.

Submit the changed paths, checks run, and whether you applied a preparatory refactor. If applied, explain its expected change-locality benefit.
