---
card: speculative-generality
title: Speculative Generality
scope: cross
bundle: map
family: abstraction
inputs: [code, map]
evidence: practitioner
also_check: [shallow-modules, dead-code, hardwired-dependencies]
refactors: [inline-class, inline-function, change-function-declaration, remove-dead-code, inline-singleton]
---

# Speculative Generality

Flexibility added for needs that don't exist: extension points, options, interfaces, factories, config knobs. Every reader pays for generality that nothing uses. Agents add it unprompted, and their vendors document the habit.

## Signals

Read this section to find candidates. If nothing here matches the code in front of you, skip the rest of the card.

- `speculative-generality.pattern-name`: `Factory`, `Strategy`, `Builder`, `Registry`, `Plugin` or `Adapter` classes, and abstract base classes.
- `speculative-generality.interface-prefix`: `I`-prefixed interfaces, which are often written for a single implementation. Weak on its own.
- `speculative-generality.single-implementation`: an interface or abstract class with one implementation and no fake, from the module map.
- `speculative-generality.test-only-export`: an export that only test files import, from the module map.

Reading cues with no machine signal:

- A parameter that every call site passes with the same value.
- Config or option keys that nothing sets.
- A plugin system or registry with one entry.
- A singleton used for convenience rather than to limit a scarce resource.
- Options exposed to every caller that only one caller needs.

## Judgment

### Confirm by

1. Count the real variants: implementations, registered plugins, distinct values passed for a parameter, and config keys set anywhere (including deploy config and env files). A test fake counts as an implementation.
2. Look for a concrete, near-term driver: a ticket, a spec, a second implementation on a branch, or the user's own statement. If one exists, flag the finding and ask instead of recommending removal.
3. Check whether the pattern replaced a large conditional. If the code or git shows it took over a switch with several live cases, it is earning its keep: a pattern that replaced a big conditional isn't over-engineering, even if it is unfamiliar.
4. Check exposure: published library API, framework extension point, or consumers outside the repo.
5. Quote the abstraction and its single use, or the call sites that all pass the same value.

### Not a finding

- Published library APIs, where outside callers are the variants.
- Seams with a real fake in the tests.
- A second implementation with a concrete near-term driver. Ask, or flag it.
- Framework extension points the framework requires.
- A pattern that replaced a large conditional.

### Boundaries

- A forwarding layer that exists today, with nothing speculative about it, belongs to [Shallow Modules](shallow-modules.md). This card is generality built for variants that don't exist.
- An export or option with no references at all, including tests, belongs to [Dead Code and Leftovers](dead-code.md).
- Exports or hooks that exist so tests can reach internals (`*ForTesting`, `NODE_ENV` checks) belong to [Hardwired Dependencies](hardwired-dependencies.md).

### Also check

- [Shallow Modules](shallow-modules.md): speculative layers usually forward straight to their single implementation.
- [Dead Code and Leftovers](dead-code.md): options nobody sets often guard branches nothing reaches.
- [Hardwired Dependencies](hardwired-dependencies.md): a single-implementation interface may be the intended seam for a collaborator tests can't otherwise replace. Then the fix is adding a fake, not deleting the interface.

### Refactors

- [Inline Class](../refactors/inline-class.md): the default for an interface or abstract base with one implementation, or a factory that builds one product. Includes Collapse Hierarchy.
- [Inline Function](../refactors/inline-function.md): for strategy functions, hooks and wrappers with one use.
- [Change Function Declaration](../refactors/change-function-declaration.md): to remove a parameter that every caller passes with the same value.
- [Remove Dead Code](../refactors/remove-dead-code.md): for option keys nothing sets, the branches behind them, and registry machinery with one entry.
- [Inline Singleton](../refactors/inline-singleton.md): when a singleton exists for convenience. Pass the object explicitly instead.

## Evidence

Practitioner. Anthropic states that its Opus 4.5 and 4.6 models tend to over-engineer, building in flexibility nobody asked for. Beck names an agent adding functionality he didn't request as a warning sign and stops it. A related but different measurement: 39.9% of agent PRs are multi-purpose against 12.2% of human PRs (Watanabe et al.; 213-PR subset). Confirming that a variant will never be needed usually takes domain knowledge, so findings here should be worded as questions when the driver is unclear.

## Aliases

Speculative Generality (Fowler ch. 3), Speculative Hierarchy, Unutilized Abstraction and Unnecessary Hierarchy (Suryanarayana), Over-Engineering and Patterns Happy (Kerievsky ch. 1, 3), Singletonitis (Kerievsky), Configuration Parameter Overuse and Overexposure (Ousterhout ch. 5, 8), unrequested scope (agent-code research).
