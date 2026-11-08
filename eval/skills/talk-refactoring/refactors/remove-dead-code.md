---
refactor: remove-dead-code
title: Remove Dead Code
direction: remove
behavior: preserving
risk: low
smells: [dead-code, reinvented-logic, speculative-generality, inconsistent-solutions, toothless-tests]
requires: []
---

# Remove Dead Code

Delete code that nothing runs or references: unused functions, exports, files, parameters, branches, flags and commented-out blocks. Version control keeps it if it is ever needed again. From Fowler's Remove Dead Code (ch. 8), Beck's Dead Code tidying (*Tidy First?* ch. 2) and Feathers' Delete Unused Code (ch. 16).

## Use when

- A compiler or linter reports an unused symbol, import, local or parameter.
- An export has no importers in the map and no external consumer.
- An old implementation still sits next to the new one after a migration or a rewrite.
- A feature flag is permanently on or off, so one branch can never run.
- `*_v2`, `*_old` or `*.bak` files, stray scripts or commented-out blocks are left from earlier attempts.
- A production branch exists only to satisfy a specific test input.

## Don't use when

- The code is part of a public API, SDK or package used outside this repository.
- You can't rule out dynamic use (see Preconditions). Record it as a suspect instead.
- A flag is off on purpose for a pending rollout with an owner and a date.

## Preconditions

Before deleting anything exported or non-local, check each of these and say which you checked:

- Entry points: `main`, CLI commands, scripts in `package.json` or `pyproject.toml`, Dockerfiles, cron and job definitions.
- Framework routes and handlers: file-based routing, decorators, migrations, serverless handlers.
- Reflection and dynamic lookup: `getattr`, `import()` with a computed path, string-keyed maps.
- DI or plugin registration: containers, registries, entry-point groups, auto-discovery by name.
- Config references: YAML, JSON, env files, infrastructure templates that name the symbol or file.
- Public API used outside the repo: published packages, exported types, documented endpoints.

## Steps

1. Delete one dead unit (a function, a branch, a file). Remove the imports and tests that existed only for it.
2. Run the type checker, the linter and the tests.
3. Repeat. Commit deletions separately from any behavior change.
4. If the deletion leaves a parameter unused, remove it with [Change Function Declaration](change-function-declaration.md).

## Verify

The build, type checker and tests pass. A search for the deleted names finds no remaining references outside version history.

## Variants

- **Drop an unused parameter**: handled by [Change Function Declaration](change-function-declaration.md), since every caller changes.
- **Retire the losing copy**: after [Replace with Existing Function](replace-with-existing-function.md) or [Substitute Algorithm](substitute-algorithm.md), delete the implementation nobody calls now.
- **Delete a bit at a time** (Beck): when confidence is low, remove one piece per commit so any surprise is easy to revert.

## Report as

A structure removal that saves readers from understanding code that does nothing. List what was checked from the precondition list. Low risk for locals and private code; treat exported, dynamically reachable or config-referenced code as medium and say so. Effort is usually small.
