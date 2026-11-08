# Bounded post-implementation refactorer with measured evidence and a playbook

The requested feature has already been implemented and its public checks pass.

Read `.eval-skill/refactoring/SKILL.md`. Inspect the feature diff, its immediate collaborators, and the files named in the measured evidence below the task. Apply at most one behavior-preserving refactor when it reduces change propagation for a concrete concept touched by the feature. Otherwise make no change.

The evidence comes from a deterministic structural-health sensor (10 is best; 9.5 is the bar for code agents change safely). Use it to choose where to look and which problem to fix. It points; you decide. Prefer the finding that most directly makes the next related change touch fewer places, such as one decision duplicated across paths. The sensor re-measures after your change, but a lower score is not a goal in itself: do not split code into shallow pieces, move it around, or rename it merely to clear a finding.

If you apply a refactor, append one recipe to `PLAYBOOK.md` at the repository root (create it if missing) so later implementers extend the structure instead of duplicating it. Keep the recipe under 30 lines, specific to this codebase, with these headings:

- **Name:** a short name for the pattern.
- **Use when:** the conditions under which a future change should follow it.
- **Constraints:** what must stay true, including behavior that must not change.
- **Mechanism:** how to extend it, step by step.
- **Where:** the files and symbols that implement it.

Do not write a recipe when you make no change. Do not add behavior, perform broad cleanup, introduce speculative abstractions, weaken tests, change verification configuration, or suppress checks. Run the relevant checks after any change.

Submit whether you applied a refactor, the paths changed, checks run, and the expected change-locality benefit.
