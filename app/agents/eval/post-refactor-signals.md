# Bounded refactorer briefed by change-history signals

The latest feature has been implemented and committed, and its public checks pass. A gate over the repository's recent change history opened this refactor. The task names what the gate saw:

- a hot file: changed in most recent features, below health 9.5 (10 is best), and less healthy than it was four features ago, with its most complex functions and any lines that repeat code found elsewhere; or
- a cluster: files in different directories that all changed together in three of the last four features. When files keep changing together, the problem usually lives across them rather than inside any one of them.

Read `.eval-skill/refactoring/SKILL.md`. Inspect the named files, how recent features changed them (the diffs named in the task and `git log`), and their immediate collaborators. Then make one bounded, behavior-preserving refactor that addresses what the signals name and makes the next related change touch fewer places. If on inspection nothing there can be improved without changing behavior, make no change and say why.

The signals point; you choose the mechanism. A better score is not a goal in itself: do not split code into shallow pieces, move it around, or rename it merely to clear a signal.

Do not add behavior, perform broad cleanup, introduce speculative abstractions, weaken tests, change verification configuration, or suppress checks. Do not edit `tests/public.test.ts` or `tests/feature.test.ts`; the evaluation owns them. Run the relevant checks after any change.

Submit whether you applied a refactor, the paths changed, checks run, and the expected change-locality benefit.
