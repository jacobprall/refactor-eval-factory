---
refactor: narrow-error-handling
title: Narrow Error Handling
direction: remove
behavior: changes-failure-paths
risk: medium
smells: [swallowed-errors]
requires: [characterization-test]
---

# Narrow Error Handling

Remove a catch, fallback or default that hides a real failure, or narrow it to the specific errors the code can handle, so everything else propagates to a caller that can. Skill-defined, from Ousterhout's "define errors out of existence" and "just crash" (ch. 10) and Anthropic's guidance against handling impossible scenarios.

## Use when

- A catch returns a default that callers can't tell apart from a real result.
- The code sits inside the system boundary, and a caller further up already handles failure.
- The handled error can't happen, or nothing sensible can be done about it at this level.

## Don't use when

- The code is the boundary: it must turn failure into a response, a retry or a message.
- The degradation is deliberate, documented and tested (best-effort cleanup, telemetry).
- Callers depend on the default and changing them is out of scope. Record the finding as "later" instead.

## Preconditions

- A [Characterization Test](characterization-test.md) of the failure path: trigger the failure and record what callers see today. Without one, the change can't be verified.
- Every caller found (use the map's importers, then search for the function name).

## Steps

1. Write the characterization test for the failure path and run it.
2. Decide the target behavior: propagate everything, or catch only named errors (`ENOENT`, `KeyError`, a specific HTTP status) and handle those.
3. Narrow or remove the catch. Prefer narrowing a broad `catch`/`except Exception` over deleting it when one error really is expected.
4. Update callers that relied on the default to handle the failure, or let it propagate to the existing boundary handler.
5. Change the characterization test's expectation to the new behavior, and add a test that an unexpected error now surfaces.
6. Run the full test suite.

## Verify

The new failure-path test fails on the old code and passes on the new. No caller converts the error back into the same silent default.

## Variants

- **Replace Exception with Precheck** (Fowler): when the failure is predictable, check the condition before the call instead of catching afterwards.
- **Narrow, don't remove**: keep the catch but list the specific errors it handles.

## Report as

A behavior change on failure paths. Name the callers that see different behavior and the boundary that will now handle the error. Effort scales with the number of callers that consumed the default.
