# Commerce

A modular monolith for a small online store. Run `npm test` before finishing any change.

## Architecture

Each module lives in `src/<module>/` and owns its data:

- `catalog`: products and prices.
- `accounts`: customers and their settings.
- `orders`: placing and changing orders.
- `billing`: invoices.
- `notifications`: messages sent to customers.
- `shared`: errors, the event bus, and small helpers used by every module.

Modules depend on each other only through `src/<module>/index.ts`. Code outside a module must not import its other files.
`src/index.ts` is the composition root: it creates every module and wires them together, and `createCommerce()` is the public entry
point.

An order and its invoice must always agree on every amount.
