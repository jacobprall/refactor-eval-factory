import type { Customer } from "../accounts/index.ts";
import { roundPercent, sumBy } from "../shared/index.ts";
import type { OrderLine } from "./types.ts";

const TAX_RATE_BY_REGION = { US: 7, EU: 20, UK: 20 };
const TIER_DISCOUNT = { standard: 0, gold: 10 };

export function priceOrderLines(customer: Customer, lines: readonly { sku: string; quantity: number; unitPriceCents: number }[]) {
  const priced: OrderLine[] = lines.map((line) => {
    const subtotalCents = line.unitPriceCents * line.quantity;
    const discountCents = roundPercent(subtotalCents, TIER_DISCOUNT[customer.tier]);
    const taxCents = roundPercent(subtotalCents - discountCents, TAX_RATE_BY_REGION[customer.region]);
    return { ...line, subtotalCents, discountCents, taxCents, totalCents: subtotalCents - discountCents + taxCents };
  });
  return {
    lines: priced,
    subtotalCents: sumBy(priced, (line) => line.subtotalCents),
    discountCents: sumBy(priced, (line) => line.discountCents),
    taxCents: sumBy(priced, (line) => line.taxCents),
    totalCents: sumBy(priced, (line) => line.totalCents),
  };
}
