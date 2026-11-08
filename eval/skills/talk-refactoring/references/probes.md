# Probes

Probes run the project's own tools. They produce the two most precise signals in the skill, `dead-code.unused-warning` and `toothless-tests.survives-stub`, and they tell the scoring step whether tests exist that would catch a refactor going wrong.

## Permission

- Ask the user before the first probe, naming the commands. Installing dependencies, running tests and type checkers takes time and can touch the network, databases or files.
- In a disposable sandbox (a fresh clone the run owns), run them without asking.
- Never run deploy, migrate, seed, publish or release scripts, or anything that needs production credentials.
- Never commit, push or leave changes behind. Every probe that edits files runs on a scratch copy or is reverted before the next step.

## Finding the commands

Use the profile's `tooling` section: `packages[].test`, `typecheck` and `lint`, `python`, and `unused_code`. If a command is missing, look at `package.json` scripts, `pyproject.toml`, `Makefile` and the CI workflows listed under `tooling.ci`; CI shows how the project really runs its checks.

Install dependencies with the lockfile's package manager (`npm ci`, `pnpm install --frozen-lockfile`, `yarn install --immutable`, `bun install --frozen-lockfile`, `pip install -r requirements.txt` or `uv sync`) only if `node_modules` or the virtualenv is missing.

## Probe 1: tests

Run the test command once with a timeout (ten minutes by default). Record passed or failed, the duration, and failing test names. A failing suite before any change is a finding to report, and it means no refactor can be verified yet: set effort one size larger for findings in affected code.

## Probe 2: unused symbols

Run the tools listed in `tooling.unused_code`, read-only:

| Tool | Command |
|---|---|
| TypeScript | `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` |
| knip | `npx knip --reporter compact` |
| Biome | `npx biome lint .` and keep the `noUnused*` diagnostics |
| ESLint | `npx eslint . --rule '{"no-unused-vars": "error"}'` (or `@typescript-eslint/no-unused-vars`) |
| Ruff | `ruff check --select F401,F841 .` |
| vulture | `vulture . --min-confidence 80` |

Record each diagnostic as a `dead-code.unused-warning` entry. These still need the Dead Code card's checks (framework entry points, reflection, public API) before they become findings, but they are close to certain.

## Probe 3: stub the body

Use it to confirm a Toothless Tests candidate, or to check that tests protect code a finding wants to refactor.

1. Work on a scratch copy, or make sure `git status` is clean so you can revert.
2. Replace the body of the function under test with a trivial return of the right type (`return undefined as any`, `return None`, an empty array).
3. Run only the tests that cover it (`npx vitest run <file>`, `npx jest <file>`, `pytest <file>`).
4. Revert with `git checkout -- <file>` and confirm with `git status`.
5. If the tests still pass, record a `toothless-tests.survives-stub` entry: those tests protect nothing about that function.

Limit this to the functions a finding depends on. It is a confirmation tool, not a sweep.

## Recording

Write `.refactor/probes.json` in the format in [formats.md](formats.md), and note in the report that probes ran (or why not).
