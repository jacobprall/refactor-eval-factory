import type { Region, Tier } from "../accounts/index.ts";
import type { TaxClass } from "../catalog/index.ts";
import { percentOf } from "../shared/index.ts";

const TAX_RATES: Record<Region, Record<TaxClass, number>> = {
  US: { standard: 7 },
  EU: { standard: 20 },
  UK: { standard: 20 },
};
const TIER_DISCOUNT: Record<Tier, number> = { standard: 0, gold: 10 };

export interface PricingLine {
  sku: string;
  quantity: number;
  unitPriceCents: number;
  taxClass: TaxClass;
}

export interface PricedLine {
  sku: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

export interface PriceQuote {
  lines: PricedLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

/** The single pricing policy: orders price with it, and invoices copy what it priced. */
export function priceLines(input: { region: Region; tier: Tier; lines: readonly PricingLine[] }): PriceQuote {
  const lines = input.lines.map((line) => {
    const subtotalCents = line.unitPriceCents * line.quantity;
    const discountCents = percentOf(subtotalCents, TIER_DISCOUNT[input.tier]);
    const taxCents = percentOf(subtotalCents - discountCents, TAX_RATES[input.region][line.taxClass]);
    return { sku: line.sku, quantity: line.quantity, unitPriceCents: line.unitPriceCents, subtotalCents, discountCents, taxCents, totalCents: subtotalCents - discountCents + taxCents };
  });
  const sum = (pick: (line: PricedLine) => number) => lines.reduce((total, line) => total + pick(line), 0);
  return {
    lines,
    subtotalCents: sum((line) => line.subtotalCents),
    discountCents: sum((line) => line.discountCents),
    taxCents: sum((line) => line.taxCents),
    totalCents: sum((line) => line.totalCents),
  };
}
