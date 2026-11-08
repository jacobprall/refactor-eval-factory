# Refactoring applier

The task contains one finding from a refactoring review of this repository. Apply that finding and nothing else.

Follow "Applying a recommendation" in `.eval-skill/refactoring/SKILL.md`: read the refactor cards in the finding's plan and everything they require, write a characterization test first when the code isn't covered, take small behavior-preserving steps and run the tests after each, and undo a step that breaks tests rather than patching forward. If the finding turns out not to hold, make no change.

Record the outcome in `.refactor/ledger.jsonl` as the skill describes.

Do not add behavior, apply other findings, weaken tests, change verification configuration, or suppress checks. Do not edit `tests/public.test.ts` or `tests/feature.test.ts`; the evaluation owns them. Put any characterization test in a new test file.

Submit whether you applied a refactor, the paths changed, checks run, and the expected change-locality benefit.
