---
card: bloated-test-setup
title: Bloated Test Setup
scope: local
bundle: test
inputs: [code, map]
evidence: practitioner + measured* (non-agentic)
also_check: [hardwired-dependencies, implementation-coupled-tests, toothless-tests]
refactors: [extract-test-helper, parameterized-test, replace-magic-literal]
severity_cap: low
---

# Bloated Test Setup

Tests bury the few inputs that matter under copied, fully populated setup and unexplained literals. Readers can't see what a test checks or why the expected value follows, and every change to a constructor or API ripples through dozens of tests. Severity is capped at low: the cost is real but bounded, and rule-based detection of these smells is unreliable.

## Signals

Read this section to find candidates. If nothing here matches the code in front of you, skip the rest of the card.

- `bloated-test-setup.duplicate-setup`: six or more normalized lines repeated three or more times across tests.
- `bloated-test-setup.magic-number-assert`: three or more assertions in a file against unexplained large numbers. HTTP status codes (100 to 599) are excluded.

Reading cues with no machine signal:

- Objects built with every field spelled out in every test, where only one field varies.
- An existing helper, factory, fixture or builder (find it in the map or the test directory) that new tests don't use.
- A `beforeEach` or `setUp` whose fields each test uses only partly.
- Expected values with no visible connection to the inputs.
- Preconditions hidden in a fixture file or seeded database that the test never mentions.
- Setup that builds deep chains of objects just to satisfy constructors.

## Judgment

### Confirm by

1. Pick one test and try to name the single input that drives its assertion. If you can't find it in the setup, or it is one value among dozens of irrelevant ones, that's the finding.
2. Check whether the repetition is deliberate. Some teams keep each test standalone on purpose (DAMP rather than DRY): short setup repeated so each test reads top to bottom is fine. Bloat is long setup copied with one value changed.
3. Search for an existing helper or fixture before proposing a new one. Tests that rebuild what a helper already provides are the clearest case.
4. For magic numbers, check whether the value can be derived from the visible inputs. `add(2, 3) == 5` is fine; `total == 18342` with no visible derivation is not.
5. Quote two of the duplicated blocks side by side, or the test with its one load-bearing value marked.

### Not a finding

- Deliberate DAMP repetition: short setup repeated so each test stands alone.
- Small golden files kept next to the test, where the file is the specification.
- Setups where every value really is load-bearing (formatting and serialization tests).
- Assertion Roulette on its own (several assertions without messages). Panichella et al. found it everywhere in human tests and rarely tied to real problems, and modern runners report the failing line. Never report it alone.
- Eager Test hits from tsDetect-style rules (several production calls in one test) unless reading confirms the test checks unrelated behaviors.

### Boundaries

- Setup that builds mocks of internal collaborators: the coupling belongs to [Implementation-Coupled Tests](implementation-coupled-tests.md); this card covers only readability.
- Setup that needs long object chains because constructors demand live collaborators is a symptom of [Hardwired Dependencies](hardwired-dependencies.md).
- Duplicated production code belongs to [Reinvented Logic](reinvented-logic.md). Duplicated test code stays here.

### Also check

- [Hardwired Dependencies](hardwired-dependencies.md): setup is often long because the code under test can't be built without its real collaborators.
- [Implementation-Coupled Tests](implementation-coupled-tests.md): much of a bloated setup is often mock configuration.
- [Toothless Tests](toothless-tests.md): an unexplained expected value may have been pasted from the code's own output, in which case the test can't disagree with the code.

### Refactors

- [Extract Test Helper](../refactors/extract-test-helper.md): the default. A creation method or test data builder with sensible defaults, so each test states only the values that matter; a custom assertion for repeated checks; a shared fixture trimmed to what every test uses. Reuse an existing helper when there is one.
- [Parameterized Test](../refactors/parameterized-test.md): when several tests differ only in inputs and expected outputs. One table, each case reported separately.
- [Replace Magic Literal](../refactors/replace-magic-literal.md): for unexplained expected values. Name the constant, or better, derive the expected value visibly from the inputs.

## Evidence

Practitioner: Willison reports duplicated setup as the most common anti-pattern in agent-written tests, and fixes it with fixtures and parametrization. Measured, non-agentic: Assertion Roulette and Magic Number Test appeared consistently across about 20,500 LLM-generated Java test suites (Ouédraogo et al.). Caveat: Panichella et al. found that a rule-based test-smell detector misclassified more than 70% of instances on tool-generated suites, and that several of these smells are common in human tests without causing problems. Hence the severity cap and the requirement to read before reporting.

## Aliases

Obscure Test with its causes Irrelevant Information, Hard-Coded Test Data, Mystery Guest, General Fixture and Eager Test; Test Code Duplication with its causes Cut-and-Paste Code Reuse and Reinventing the Wheel (Meszaros ch. 15); Magic Number Test (tsDetect); duplicated setup (Willison).
