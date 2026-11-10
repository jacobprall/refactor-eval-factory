---
card: swallowed-errors
title: Swallowed Errors
scope: local
bundle: source
inputs: [code, map]
evidence: measured (single vendor) + practitioner
also_check: [toothless-tests, hardwired-dependencies]
refactors: [narrow-error-handling, introduce-assertion, introduce-special-case, move-function, characterization-test]
---

# Swallowed Errors

Code catches, defaults or null-coalesces around failures that should surface, so a real error becomes a wrong value or a silent no-op. Validation is repeated deep inside internal code instead of once at the system boundary.

## Signals

Read this section to find candidates. If nothing here matches the code in front of you, skip the rest of the card.

- `swallowed-errors.empty-catch`: a catch block or `.catch()` that does nothing.
- `swallowed-errors.catch-default`: a catch that returns `null`, `[]`, `false` or another default, sometimes after logging.
- `swallowed-errors.log-and-continue`: a catch whose only action is a log line, after which execution carries on.
- `swallowed-errors.broad-except`: Python's bare `except:` or `except Exception:`.
- `swallowed-errors.nullish-default`: `?? []`, `?? ''`, `?? 0` fallbacks. Check whether the type can actually be null there.

Reading cues with no machine signal:

- `?.` chains on values the types say can't be null or undefined.
- The same input validated again in several layers.
- Log-and-rethrow at every level of a call chain.
- A fallback branch that no test exercises.

## Judgment

### Confirm by

1. Find what the caller does with the default. If it treats `null` or `[]` as a real answer ("no results"), the failure is now indistinguishable from a legitimate empty result. That is the finding.
2. Use the map to decide whether the function sits at a system boundary (user input, network, filesystem, third-party API). Inside the boundary, a caught failure should usually propagate.
3. Quote the catch and the line that consumes its result.

### Not a finding

- Real boundaries that translate failure into a defined response (an HTTP 4xx, a CLI error message, a retry with backoff).
- Documented, tested graceful degradation: best-effort cleanup (`rm -rf` of a temp dir), telemetry, cache reads with a fallback to the source.
- Deliberate masking that returns a *correct* defined result (Ousterhout's "define errors out of existence": `substring` clamping its indexes). Swallowing returns a *wrong* result silently.
- Queue or stream writers that must not break the chain (`pending.then(write).catch(() => {})`) when the failure is reported elsewhere.

### Boundaries

- A catch inside a test belongs to [Toothless Tests](toothless-tests.md).
- `if (NODE_ENV === 'test')` fallbacks belong to [Hardwired Dependencies](hardwired-dependencies.md).

### Also check

- [Toothless Tests](toothless-tests.md): swallowed errors usually mean no test covers the failure path.
- [Hardwired Dependencies](hardwired-dependencies.md): failures that can't be simulated in tests get caught "just in case".

### Refactors

- [Narrow Error Handling](../refactors/narrow-error-handling.md): the default. Remove the catch or narrow it to the errors the code can actually handle. **Changes failure-path behavior**: label it and pin the failure path first.
- [Introduce Assertion](../refactors/introduce-assertion.md): when the catch guards a state that should be impossible.
- [Introduce Special Case](../refactors/introduce-special-case.md): when many callers repeat the same null check for one legitimate "missing" case.
- [Move Function](../refactors/move-function.md): to move repeated validation out to the boundary, once.
- [Characterization Test](../refactors/characterization-test.md): the precondition for all of the above when the failure path is untested.

## Evidence

Measured, single vendor: error-masking constructs (catch density, safe navigation, stubbed methods) rose 47% in GitClear's 2026 report; its detection rules weren't published. Practitioner: Anthropic's prompting guidance tells its models not to add error handling, fallbacks or validation for scenarios that can't happen.

## Aliases

Error masking / defensive overkill (agent-code research), Too Many Exceptions (Ousterhout ch. 10), the null-guard form of Conditional Complexity (Kerievsky ch. 4), the motivation for Introduce Null Object (Kerievsky ch. 9).
