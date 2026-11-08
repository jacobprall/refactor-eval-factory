---
refactor: sprout
title: Sprout Method / Sprout Class
direction: add
behavior: preserving
risk: low
smells: [overloaded-module, tangled-function]
requires: []
---

# Sprout Method / Sprout Class

When new behavior has to go into an overloaded function or class, write it as a new function or class, developed under test, and add a single call to it from the old code. The old code is barely touched and the new code is tested from the start. This is a preventive move: it stops an overloaded unit from growing rather than shrinking it. From Feathers (ch. 6).

## Use when

- A feature or fix needs new logic inside a long, tangled function or a module that already does too much.
- The host is hard to put under test, but the new logic is not.
- The default would be to append another branch or block to the largest file in reach, which is how agent-written modules tend to grow.

## Don't use when

- The new behavior is a line or two that fits the host's existing responsibility. Added indirection is itself a cost and needs a concrete driver; here the driver is new behavior substantial enough to deserve its own test.
- The new logic is interleaved with existing steps and needs most of the host's local state. Pin the host with a [Characterization Test](characterization-test.md) and use [Extract Function](extract-function.md) first.
- The host is small, tested and cohesive. Just change it.

## Preconditions

- The insertion point in the host and the values the new code needs from it. Pass those in as parameters; don't give the new unit access to the host's internals.
- No characterization test of the host is required, because the host changes by one call. If the host already has a test harness, add a test that the call happens.

## Steps

1. Identify where the new behavior belongs in the host and what goes in and comes out.
2. Write a failing test for the new function (Sprout Method) or class (Sprout Class) in isolation.
3. Implement it until the test passes.
4. Add a single call from the host at the insertion point, passing values in and using the return value. Don't reformat or restructure anything else in the host.
5. Run the full suite.
6. Record the host as a candidate for later decomposition; sprouting doesn't improve it.

## Verify

The host's diff is one call plus any parameter plumbing. The new unit has its own tests, and they fail if its body is stubbed out.

## Variants

- **Sprout Method** (Feathers): the new behavior becomes a function or method beside the host.
- **Sprout Class** (Feathers): when the host class can't be built in a test at all, the new behavior goes in a new class that the host creates and calls. It may look odd at first and can later become the home for related logic.
- **Wrap Method** (Feathers): when the new behavior runs entirely before or after the existing behavior, rename the old function and add a new function with the old name that calls it plus the new code. Callers don't change.

## Report as

A preventive add-structure move, recommended alongside a pending change rather than on its own. Name the host that would otherwise grow and the new unit's responsibility. Effort is the cost of the new behavior itself; the host is left as it is, so pair this with a separate decomposition finding if it warrants one.
