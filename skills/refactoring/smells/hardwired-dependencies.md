---
card: hardwired-dependencies
title: Hardwired Dependencies
scope: local
bundle: source
inputs: [code, map]
evidence: hypothesis
also_check: [implementation-coupled-tests, swallowed-errors, tangled-function]
refactors: [inject-dependency, wrap-third-party-api, separate-query-from-modifier, humble-object, encapsulate-variable, extract-interface, inline-singleton, characterization-test]
---

# Hardwired Dependencies

Code creates or reaches for its collaborators itself: clients built inline, module-level singletons, environment reads deep in logic, vendor SDK calls woven through business rules. Nothing outside the function can choose a different implementation, so tests patch module internals and production code grows test-only branches.

## Signals

Read this section to find candidates. If nothing here matches the code in front of you, skip the rest of the card.

- `hardwired-dependencies.inline-client`: a client, SDK, pool or connection constructed inside the code that uses it (`new Stripe(...)`, `createClient()`, `boto3.client(...)`, `httpx.Client()`).
- `hardwired-dependencies.env-read`: `process.env` or `os.environ` read outside config and settings files.
- `hardwired-dependencies.test-hook`: production code that checks whether it is running under tests (`NODE_ENV === 'test'`, `PYTEST_CURRENT_TEST`) or exposes `*ForTesting` / `*_for_test` members.
- `hardwired-dependencies.module-singleton`: an instance created at import time at module level (`export const db = new Pool(...)`, `client = OpenAI()`).

Reading cues with no machine signal:

- One vendor SDK imported directly by many domain modules (check the map's import lists).
- A function that returns nothing and mixes computation with I/O, so a test can't observe what it decided.
- A constructor that builds a web of collaborators itself.
- `Date.now()`, `datetime.now()`, `Math.random()` or `uuid4()` inside logic whose result depends on them.
- Nearby tests that patch module paths (`jest.mock('../db')`, `patch('app.billing.stripe')`) just to run.

## Judgment

### Confirm by

1. Apply Feathers' enabling-point check to each candidate call. A call is substitutable only if something outside the function chooses the implementation: a parameter, a constructor argument, a field the caller sets, a factory the caller supplies. If the object is created or imported right there and used directly, there is no enabling point. That is the finding.
2. Check whether it matters. Does the collaborator do I/O, keep state across calls, cost money, or depend on time or randomness? A hardwired pure helper is fine.
3. Look at how existing tests cope. Module patching, env-var juggling or a test-only branch in production is the cost made visible.
4. Use the map to see whether the same SDK or env key is reached from many modules. That widens the fix from one function to a wrapper.
5. Quote the construction or read, and the line of logic that depends on it.

### Not a finding

- Composition roots: `main`, app factories, DI container setup, server bootstrap and framework wiring files. Their job is to construct and connect collaborators, so creating clients there is correct.
- Pure, deterministic helpers and value objects (`new Map()`, `new URL(...)`, a date built from a fixed value).
- Configuration read once at startup into an immutable object that is then passed in.
- Thin glue scripts and one-off CLIs with no logic worth testing in isolation.
- Deliberate seams that default to the real thing (`function charge(order, clock = systemClock)`). Those already have an enabling point.

### Boundaries

- When tests mock heavily because there is nothing to inject, the test side belongs to [Implementation-Coupled Tests](implementation-coupled-tests.md) and the production cause belongs here. Report both and link them.
- Two different clients for the same job (two HTTP libraries) belong to [Inconsistent Solutions](inconsistent-solutions.md).
- The same env key or config literal read in many files is [Scattered Knowledge](scattered-knowledge.md). This card covers only the fact that the read happens inside logic.
- A branch keyed to one test's literal input is gaming, not a hook; it belongs to [Toothless Tests](toothless-tests.md).

### Also check

- [Implementation-Coupled Tests](implementation-coupled-tests.md): mocks of internal modules often exist only because there is nothing to inject, and fixing this card is what lets those tests use fakes.
- [Swallowed Errors](swallowed-errors.md): failures of a hardwired client can't be simulated in tests, so code tends to catch them "just in case".
- [Tangled Function](tangled-function.md): a function that builds its own client usually also mixes validation, decisions and I/O in one body.

### Refactors

- [Inject Dependency](../refactors/inject-dependency.md): the default. Pass the collaborator in as a parameter or constructor argument, with a default so existing callers don't change.
- [Wrap Third-Party API](../refactors/wrap-third-party-api.md): when a vendor SDK is called from many places. Put the calls behind one module that speaks the domain's terms; for large APIs, wrap by responsibility rather than mirroring the SDK.
- [Separate Query from Modifier](../refactors/separate-query-from-modifier.md): when one function both computes a decision and performs the side effect. Split them so the decision can be tested without the I/O.
- [Humble Object](../refactors/humble-object.md): for handlers, UI callbacks and framework hooks. Move the logic into a plain object and leave the boundary too thin to need testing.
- [Encapsulate Variable](../refactors/encapsulate-variable.md): for a mutable global or env read used in many places. Route access through one function first, as a step toward injection.
- [Extract Interface](../refactors/extract-interface.md): only when a fake will be the second implementation. One implementation and no fake is [Speculative Generality](speculative-generality.md).
- [Inline Singleton](../refactors/inline-singleton.md): when a singleton exists for convenience rather than to limit a resource. Pass the instance explicitly.
- [Characterization Test](../refactors/characterization-test.md): before changing any constructor or signature that untested code depends on.

## Evidence

Hypothesis. That agents hardwire collaborators more than people do rests on reasoning in Feathers and Meszaros applied to agent output; no study counts it. The measured over-mocking result in [Implementation-Coupled Tests](implementation-coupled-tests.md) is consistent with it but doesn't show the cause. Scoring gives this card no agent-prevalence bonus.

## Aliases

Hidden Dependency, Irritating Global Dependency, Construction Blob, Irritating Parameter, Onion Parameter and Undetectable Side Effect (Feathers ch. 9-10), Library Dependencies and Application Is All API Calls (Feathers ch. 14-15), Global Data (Fowler ch. 3), Hard-to-Test Code and Test Logic in Production (Meszaros ch. 15), For Testers Only (van Deursen), Connector Envy (Garcia et al.), Missing Seams (former working name). Explicit Parameters (Beck ch. 10) is the target state.
