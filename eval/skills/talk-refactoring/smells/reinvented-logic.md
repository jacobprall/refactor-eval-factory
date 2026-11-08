---
card: reinvented-logic
title: Reinvented Logic
scope: cross
bundle: map
family: duplication
inputs: [code, map]
evidence: measured
also_check: [inconsistent-solutions, scattered-knowledge, dead-code]
refactors: [replace-with-existing-function, parameterize-function, substitute-algorithm, extract-function, move-function, combine-functions, inline-function, remove-dead-code, characterization-test]
---

# Reinvented Logic

New code re-implements behavior that the codebase, a dependency or the standard library already provides, usually under a different name and shape. There are now two things to keep in sync and no way to tell which one is the real one.

## Signals

Read this section to find candidates. If nothing here matches the code in front of you, skip the rest of the card.

- `reinvented-logic.duplicate-name`: the same top-level function name is defined in two or more files in different modules.
- `reinvented-logic.literal-clone`: six or more normalized lines shared verbatim between source files. Weak on purpose: most agent duplication is short or semantic, so a clone hit supports a finding but never decides one.
- `reinvented-logic.common-helper`: a hand-rolled generic helper (`sleep`, `retry`, `debounce`, `chunk`, `slugify`, `formatDate`, ...) that a dependency or the standard library may already provide.
- `reinvented-logic.similar-responsibility`: two modules whose one-line responsibilities or domain terms overlap. This comes from the model pass over the module map, so treat it as a lead to read, not a match.

Reading cues with no machine signal:

- Verb and noun synonyms across modules: `formatDate` and `toDisplayDate`, two `retry` helpers, two config loaders.
- Function families that differ by one literal or field (`findByName`, `findByNameAndStatus`, `findByNameAndOwner`).
- Two classes that do the same job behind different interfaces.
- A new module that calls almost none of the existing code around it, or an old and a new path for the same concept both still live.

## Judgment

### Confirm by

1. Name the candidate pair: the new or changed function, and the existing one found through the map's responsibilities, the dependency list or the standard library.
2. Read both. List the inputs that matter and compare behavior on each, paying most attention to edges: rounding, time zones and DST, empty or null input, encoding, and what happens on error.
3. If it's cheap, write a quick comparison test that runs both on the same inputs, including the edges above.
4. Name the canonical one: usually the dependency or standard-library version, or the copy with more callers and tests.
5. Quote both definitions side by side, plus one call site of the copy that would be retired.

### Not a finding

- Look-alikes that differ in edge semantics (one rounds half-up and the other half-even, one uses local time and the other UTC, one throws and the other returns `null`). This is the most dangerous case: merging them changes behavior. Report the difference instead, or treat unifying them as a deliberate behavior change.
- Deliberate duplication across bounded contexts or deployable boundaries that must not share code.
- A second copy with no third in sight and no drift yet, where a shared helper would be premature. Record it as info.
- Adapters that resemble the API they wrap.
- Names repeated by framework convention (route handlers, `loader`, `main`, per-package `index`).
- Generated or vendored code, and DAMP test code.

### Boundaries

- Two different *mechanisms* or conventions for the same kind of concern (two HTTP clients, exceptions in one module and result objects in another) belong to [Inconsistent Solutions](inconsistent-solutions.md). This card is the same computation written twice.
- One decision (a literal, a type tag, a business rule) encoded at many sites so that one change needs many edits belongs to [Scattered Knowledge](scattered-knowledge.md).
- Copied setup inside tests belongs to [Bloated Test Setup](bloated-test-setup.md).
- Once callers have moved to the canonical version, the leftover copy belongs to [Dead Code and Leftovers](dead-code.md).

### Also check

- [Inconsistent Solutions](inconsistent-solutions.md): a reinvented helper often brings its own convention with it.
- [Scattered Knowledge](scattered-knowledge.md): copies that encode a business rule must change together until they are merged.
- [Dead Code and Leftovers](dead-code.md): the retired copy, its tests and its exports need to go in the same change.

### Refactors

- [Replace with Existing Function](../refactors/replace-with-existing-function.md): the default, when the canonical version already exists and the edge semantics match.
- [Parameterize Function](../refactors/parameterize-function.md): for families that differ only by a literal or field.
- [Substitute Algorithm](../refactors/substitute-algorithm.md): when both versions must converge on one implementation that neither currently is.
- [Extract Function](../refactors/extract-function.md): when the shared logic is buried inside larger functions and has to be pulled out before it can be reused. Slide related statements together first if they are interleaved.
- [Move Function](../refactors/move-function.md): to put the surviving version in the module whose responsibility covers it.
- [Combine Functions](../refactors/combine-functions.md): when several copies each derive values from the same data.
- [Inline Function](../refactors/inline-function.md): when the copy is a thin wrapper around the canonical version.
- [Remove Dead Code](../refactors/remove-dead-code.md): to delete the retired copy once nothing calls it.
- [Characterization Test](../refactors/characterization-test.md): the precondition when the copy being retired has no tests of its own.

## Evidence

Measured. On 617 PRs from one Python repo, functions added by agents scored about 1.87 times higher on semantic redundancy against existing functions than those added by humans (Huang et al.). Clones in agent PRs tend to survive review into the codebase (Uchoa et al.; no human baseline). Industry-wide, GitClear's 2026 report shows duplicate blocks up 81%, moved lines down from 21% (2022) to 3.8%, and calls from new code into existing functions down 35%; this is vendor data and correlational. GitClear 2025 shows copy/paste lines rising from 8.3% to 12.3%; its widely quoted 24.1% to 9.5% drop in moved lines is `[secondary]`. In Watanabe et al., reviewer revisions to merged agent PRs often removed duplication. Counterweight: both causal studies (He et al. v2; Agarwal et al.) found no significant rise in SonarQube's literal duplicate-line density, which is why `literal-clone` carries low weight.

## Aliases

Duplicated Code (Fowler ch. 3; Kerievsky ch. 4), Repetition (Ousterhout ch. 9), I'm Changing the Same Code All Over the Place (Feathers ch. 21), Combinatorial Explosion (Kerievsky ch. 4), Alternative Classes with Different Interfaces (Fowler ch. 3), Significant Duplication (Lanza & Marinescu), Duplicate Abstraction (Suryanarayana), Solution Approach (Mäntylä), reimplementation instead of reuse and isolated additions (agent-code research).
