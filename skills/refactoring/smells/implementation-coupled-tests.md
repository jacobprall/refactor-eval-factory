---
card: implementation-coupled-tests
title: Implementation-Coupled Tests
scope: local
bundle: test
inputs: [code, git]
evidence: measured + practitioner
also_check: [hardwired-dependencies, toothless-tests, bloated-test-setup]
refactors: [replace-mock-with-fake, assert-on-outcome, extract-test-helper, inject-dependency, humble-object]
---

# Implementation-Coupled Tests

Tests verify *how* the code does its job (calls to mocked internals, call order, exact strings, private state, even the source text) instead of *what* it achieves. Behavior-preserving refactors break them, so they block exactly the work this skill recommends, and their mocks can hide real integration failures.

## Signals

Read this section to find candidates. If nothing here matches the code in front of you, skip the rest of the card.

- `implementation-coupled-tests.mock-heavy-file`: a test file with far more mocks than most test files in this repo.
- `implementation-coupled-tests.call-assertion`: assertions on calls to collaborators (`toHaveBeenCalledWith`, `toHaveBeenCalledTimes`, `assert_called_once_with`, `call_args`), three or more in a file.
- `implementation-coupled-tests.module-patch`: tests that patch the project's own modules by path (`jest.mock('./billing')`, `patch('app.orders.repo')`).
- `implementation-coupled-tests.snapshot`: snapshot assertions, three or more in a file. A problem only when the output isn't the point of the feature.
- `implementation-coupled-tests.source-text-read`: tests that read the project's own source files (under `src/`, `app/` or `lib/`) as text and assert on their contents. Reading a file the code under test wrote is not this.

Reading cues with no machine signal:

- Few or no assertions on return values or resulting state; every check is about calls.
- Mocks of modules in the same package as the code under test.
- Expectations that restate the implementation line by line.
- `toString()`, `str()` or `JSON.stringify` applied to the actual value inside an assertion.
- Tests that reach into private members (`_cache`, name-mangled attributes) to check state.
- Git: test files that change in commits that don't change behavior (renames, extractions).

## Judgment

### Confirm by

1. Apply Feathers' sensing versus separation test to each double. A double earns its place if it *senses* (records an output the test can't otherwise see, such as an email sent) or *separates* (keeps a slow, unsafe or non-deterministic dependency out of the test, such as the network or the clock). A double that does neither only mirrors the implementation. That is the finding.
2. For each call assertion, ask whether the call itself is the requirement. At an architectural boundary it often is: an email is sent, an event is published, a payment API is called. Between two internal functions it almost never is.
3. Imagine a behavior-preserving refactor of the code under test: inline a helper, rename an internal function, reorder independent calls. If the test would fail, it is coupled.
4. Check whether a return value or resulting state is observable. If it is and the test ignores it, the test can assert on that instead.
5. Note why the mock exists. If the code under test constructs the collaborator itself, the mock is a symptom of [Hardwired Dependencies](hardwired-dependencies.md).
6. Quote the double, the assertion on it, and the production line it mirrors.

### Not a finding

- Interaction at an architectural boundary where the interaction is the requirement: sending an email, publishing an event, calling a payment or other third-party API, writing an audit record.
- String output that is the feature: serializers, formatters, CLI output, rendered templates. Snapshots of those are fine when small and reviewed.
- Doubles that separate a slow or unsafe dependency and are not asserted on (a stubbed network client returning canned data).
- Codebases that follow mockist (London-school) TDD by convention. Lower priority; note the convention rather than fight it.
- Contract tests between services that deliberately pin a request shape.

### Boundaries

- A test whose assertions are trivial, or check only a mock's canned return value, belongs to [Toothless Tests](toothless-tests.md).
- The production code that forced the mocks belongs to [Hardwired Dependencies](hardwired-dependencies.md). Report both and link them.
- Long setup that builds justified mocks belongs to [Bloated Test Setup](bloated-test-setup.md).

### Also check

- [Hardwired Dependencies](hardwired-dependencies.md): mocks often exist because there is nothing to inject, and fixing the production side is what lets the test change.
- [Toothless Tests](toothless-tests.md): when a mock supplies the value under assertion, the test may check nothing at all.
- [Bloated Test Setup](bloated-test-setup.md): mock-heavy tests usually carry long, copied mock configuration.

### Refactors

- [Replace Mock with Fake](../refactors/replace-mock-with-fake.md): the default for internal collaborators. Use the real object when it is fast and safe, or a small hand-written fake (an in-memory repository) when it isn't. Keep mocks at boundaries only.
- [Assert on Observable Outcome](../refactors/assert-on-outcome.md): when a return value or resulting state is available. Replace call assertions with assertions on it.
- [Extract Test Helper](../refactors/extract-test-helper.md): for exact-string comparisons, a custom assertion that compares only the fields that matter; for repeated mock setup, one helper that hides it.
- [Inject Dependency](../refactors/inject-dependency.md): on the production side, when the mock exists only because the collaborator can't be passed in.
- [Humble Object](../refactors/humble-object.md): on the production side, when logic lives inside a handler or framework callback. Move it out so it can be tested without mocking the framework.

## Evidence

Measured: among commits that touch tests, 36% of coding-agent commits add mocks against 26% of non-agent commits. Agent commits also touch tests more often (23% of all commits vs 13%), and agents chose the mock type of test double 95% of the time, where humans also used fakes and spies (Hora & Robbes; about 1.25M commits across 2,168 TypeScript, JavaScript and Python repos). Practitioner: Pocock reports agent tests that check the order of strings in source text instead of rendering the page, and mocks that hide real failure modes.

## Aliases

Overspecified Software (alias Overcoupled Test), Fragile Test, Sensitive Equality and High Test Maintenance Cost (Meszaros ch. 16-17), over-mocking, implementation-mirroring tests and source-text tests (Pocock; agent-code research), change-detector tests.
