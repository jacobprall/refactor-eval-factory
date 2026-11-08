---
refactor: replace-primitive-with-object
title: Replace Primitive with Object
direction: add
behavior: preserving
risk: medium
smells: [scattered-knowledge]
requires: [characterization-test]
---

# Replace Primitive with Object

Turn a bare string, number or dictionary that has grown rules (validation, parsing, formatting, comparison, unit conversion, allowed values) into a small type that owns those rules. From Fowler (ch. 7) and Kerievsky's Replace Type Code with Class (ch. 9). A new type is one more concept for every reader and every call site, and added indirection is itself a cost (Beck, ch. 31; Kerievsky, ch. 1). Use the move only when the primitive's rules repeat across sites; the count of repeats is the driver.

## Use when

- The same validation, parsing or formatting of one value is repeated at several sites: an email check, money rounding, an ID prefix test, a phone format.
- A string type code (`"pending"`, `"active"`) is compared against literals in many places, and an invalid value has caused or could cause a bug.
- Values in different units or currencies travel as plain numbers and get mixed.

## Don't use when

- The value has no rules: it is stored, passed and displayed as is.
- The rules live at one site. A type that serves one site is indirection without payoff.
- The type checker already covers it cheaply, with a literal union or enum and no attached behavior. Move to a class only when behavior is already attached or a change is about to attach it.
- Wrapping would change a persisted format or a wire contract.

## Preconditions

- Every site that creates, validates, compares or formats the value found.
- A [Characterization Test](characterization-test.md) for the repeated rule, including invalid inputs, at the sites where copies may differ.

## Steps

1. Create a type that wraps the value, with a constructor or factory that applies the existing validation and an accessor for the raw value. Use the project's idiom: a class, a branded type, `NewType`, a frozen dataclass, a value struct.
2. Run the tests.
3. Change one field or variable that holds the primitive to hold the new type, converting where the value is created. Leave consumers reading the raw value through the accessor. Run the type checker; it lists the sites that must change.
4. Move one repeated rule into the type and replace each copy of it with a call, testing after each site. Repeat per rule.
5. Make equality compare by value if instances are compared.
6. Convert back to the primitive only at the boundaries: persistence, serialization, display.
7. Run the full test suite.

## Verify

A search for each old rule (the regex, the rounding call, the literal comparisons) finds it only inside the type. Tests, including the invalid inputs, pass. Serialized output is unchanged.

## Variants

- **Replace Type Code with Class** (Kerievsky): when a primitive type code can be assigned invalid values or compared unsafely, make its type a class that admits only valid codes. A class rather than an enum leaves room to add behavior, and it is a first step toward [Replace Conditional with Polymorphism](replace-conditional-with-polymorphism.md) when behavior varies by code.

## Report as

Behavior-preserving when every site already applied the same rules; if the copies differed, unifying them changes behavior at the outliers and must be labeled. Name the primitive, the repeated rule and the number of sites that repeat it. Effort scales with the number of creation sites. Mark it high risk if it touches persisted data.
