---
refactor: wrap-third-party-api
title: Wrap Third-Party API
direction: add
behavior: preserving
risk: medium
smells: [hardwired-dependencies]
requires: [characterization-test]
---

# Wrap Third-Party API

Put an interface of your own between business logic and a vendor SDK or library, so the application depends on your terms and tests can fake them. From Feathers' chapter on applications that are all API calls (ch. 15), which offers two forms: mirror the API thinly (Skin and Wrap the API) or extract the jobs your code does with it (Responsibility-Based Extraction). If a wrapper turns out to forward every call unchanged and nothing fakes it, the inverse is [Remove Middle Man](remove-middle-man.md).

## Use when

- One vendor SDK (payments, an LLM client, cloud storage, an ORM) is imported across many domain modules.
- Business decisions are interleaved with SDK calls, so testing a decision means faking the vendor.
- Tests mock the SDK's own classes or HTTP calls, which couples every test to the vendor's API shape.
- Vendor types appear in your domain function signatures.

## Don't use when

- The library is stable and free of side effects (a date or string utility). Wrapping it buys nothing.
- The SDK is used in one place that is already thin glue. Cover that place with an integration test.
- No test, second vendor or pending migration needs the wrapper. Added indirection is itself a cost, and a mirror wrapper that nothing fakes is one of the [Shallow Modules](../smells/shallow-modules.md).

## Preconditions

- A [Characterization Test](characterization-test.md) at a pinch point above the SDK calls (a route handler, a service method), recording the observable result with the vendor stubbed at its network boundary or run against a sandbox.
- Every call site, from the map's importers of the SDK package.

## Steps

1. Write the characterization test and run it.
2. Group the call sites by what they accomplish ("charge a card", "store an upload", "summarize a document"), not by SDK method.
3. Choose the form. For a large API, prefer responsibility-based extraction: one function per job, named in domain terms. For a small API or a planned vendor swap, a thin mirror is acceptable.
4. Create the wrapper module with one function for the first job, moving the existing SDK calls into it unchanged. Translate vendor errors and types into your own at this boundary.
5. Replace the first call site with the wrapper and run tests. Repeat one call site at a time.
6. Pass the wrapper into the business logic that uses it ([Inject Dependency](inject-dependency.md)) and write a fake of it for tests.
7. Confirm the SDK is now imported only by the wrapper. Run the full suite.

## Verify

The characterization test passes unchanged. The map shows the SDK imported by the wrapper module alone. Domain tests use the fake wrapper and no longer mock vendor classes.

## Variants

- **Skin and Wrap the API** (Feathers): a thin interface that mirrors the vendor API closely. Best when the API is small or you want full insulation from the vendor.
- **Responsibility-Based Extraction** (Feathers): extract the higher-level jobs your code performs with the API. Usually the practical choice for large SDKs and for agent code that scatters SDK calls inline.
- **Adapt Parameter** (Feathers, ch. 25): when one parameter type (a framework request object) is hard to fake, define a narrow interface of your own and an adapter around the real type, and change the method to take the interface.

## Report as

A behavior-preserving add-structure move. Name the SDK, how many modules import it, and the form chosen with the reason. Effort scales with the number of call sites; the main risk is error and type translation at the new boundary, which the characterization test must cover.
