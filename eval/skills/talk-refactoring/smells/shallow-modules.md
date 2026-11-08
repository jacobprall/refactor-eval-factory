---
card: shallow-modules
title: Shallow Modules
scope: cross
bundle: map
family: abstraction
inputs: [code, map]
evidence: practitioner
also_check: [speculative-generality, hardwired-dependencies, overloaded-module]
refactors: [inline-function, inline-class, remove-middle-man, move-function]
---

# Shallow Modules

Layers, wrappers or tiny units whose interface costs about as much to learn as what they hide. Readers hop between files without gaining any abstraction, and every extra hop is context an agent has to load.

## Signals

Read this section to find candidates. If nothing here matches the code in front of you, skip the rest of the card.

- `shallow-modules.pass-through`: a named function whose whole body is one forwarding call.
- `shallow-modules.forwarding-arrow`: a top-level arrow function whose body is a single call.
- `shallow-modules.fragmented-module`: a module of six or more files with a median under 20 lines.
- `shallow-modules.shallow-interface`: an exported interface nearly as large as the implementation behind it. This comes from the module map's interface and implementation sizes.

Reading cues with no machine signal:

- Adjacent layers with mirrored signatures, such as a service between a controller and a repository that adds nothing.
- A parameter threaded through several layers that only the bottom one uses.
- A helper called once that takes most of its parent's locals.
- A class with one public verb-named method (`*Manager`, `*Processor`).
- Internals exported "just in case", which widens the interface without adding depth.

## Judgment

### Confirm by

1. Apply the deletion test (Pocock): imagine deleting the unit and putting its body at each caller. If the code just moves over unchanged and callers get no harder to read, the unit is shallow. If complexity would spread or repeat across callers, the unit is earning its keep.
2. Count what sits behind it: real implementations and test fakes. One adapter is a hypothetical seam, two is a real one, and a fake counts as the second.
3. Check what it adds: validation, caching, auth, retries, translation of errors or types. Any real behavior means it isn't shallow.
4. Check exposure: a public API, a framework hook, or a package entry point has reasons to exist beyond depth.
5. Quote the unit's body and one of its callers.

### Not a finding

- Adapters that isolate a third party and have a second implementation or a fake.
- Dispatchers that choose among implementations.
- Decorators that add real behavior (auth, caching, logging).
- Framework-required hooks such as route handlers and lifecycle methods.
- Public API facades and a package's single entry-point file that defines its public surface.
- Small value types that exist for type safety.

### Boundaries

- Generality built for variants that don't exist (an interface with one implementation, options nobody sets) belongs to [Speculative Generality](speculative-generality.md). This card is a forwarding layer that exists today.
- A wrapper that nothing calls belongs to [Dead Code and Leftovers](dead-code.md).
- A wrapper that exists only as a test seam for a collaborator that can't otherwise be replaced belongs to [Hardwired Dependencies](hardwired-dependencies.md), which decides whether the seam is needed.
- Splitting a long function into helpers that must be read together is the conjoined-helpers guard on [Tangled Function](tangled-function.md); when you find those helpers already split, they are shallow and belong here.

### Also check

- [Speculative Generality](speculative-generality.md): single-implementation interfaces usually sit behind the same forwarding layers.
- [Hardwired Dependencies](hardwired-dependencies.md): before inlining a wrapper, make sure it isn't the only seam the tests use.
- [Overloaded Module](overloaded-module.md): the module that absorbs inlined code must not become a grab-bag.

### Refactors

- [Inline Function](../refactors/inline-function.md): the default for pass-through functions and once-called helpers. Includes Beck's One Pile: inline everything, then re-split along better lines.
- [Inline Class](../refactors/inline-class.md): for thin classes and fragmented files. Includes Collapse Hierarchy, Replace Command with Function, and merging fragments into one deeper module.
- [Remove Middle Man](../refactors/remove-middle-man.md): when a layer forwards most of another layer's methods. Let callers use the lower layer directly.
- [Move Function](../refactors/move-function.md): when the layer should stay because it marks a real boundary. Move in logic that its callers repeat, so the layer does real work.

## Evidence

Practitioner. Anthropic documents its Opus 4.5 and 4.6 models creating extra files and unnecessary abstractions, and its prompting guidance tells models not to create helpers for one-time operations. Pocock argues that shallow modules make a codebase harder for agents to work in, and his architecture skill applies the deletion test. That agents produce shallow modules more than humans do is a hypothesis; nothing measures it.

## Aliases

Shallow Module, Classitis, Pass-Through Method, Pass-Through Variable and Conjoined Methods (Ousterhout ch. 4, 7, 9), Middle Man and Lazy Element (Fowler ch. 3), Lazy Class and Indecent Exposure (Kerievsky), Imperative Abstraction and Unnecessary Abstraction (Suryanarayana), shallow-module fragmentation (agent-code research), the One Pile triggers (Beck, *Tidy First?*). Former working name: Shallow Indirection.
