import type { Region, Tier } from "../accounts/index.ts";
import type { TaxClass } from "../catalog/index.ts";
import { fail, percentOf, requireNonNegativeInt } from "../shared/index.ts";

const TAX_RATES: Record<Region, Record<TaxClass, number>> = {
  US: { standard: 7, reduced: 3 },
  EU: { standard: 20, reduced: 5 },
  UK: { standard: 20, reduced: 5 },
};
const TIER_DISCOUNT: Record<Tier, number> = { standard: 0, silver: 5, gold: 10 };
const BULK_QUANTITY = 10;
const BULK_DISCOUNT = 5;
const MAX_DISCOUNT = 60;

export interface ShippingPolicy {
  rates: Record<Region, number>;
  freeFromCents: number;
}

export interface PricingPolicy {
  promotions: Record<string, number>;
  shipping?: ShippingPolicy;
  taxRounding: "line" | "order";
}

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
  shippingCents: number;
  taxCents: number;
  totalCents: number;
}

export function createPricingPolicy(options: { promotions?: Record<string, number>; shipping?: ShippingPolicy; taxRounding?: "line" | "order" }): PricingPolicy {
  for (const [code, percent] of Object.entries(options.promotions ?? {})) {
    if (!Number.isInteger(percent) || percent < 1 || percent > 50) fail("invalid_input", `promotion ${code} must be 1 to 50 percent`);
  }
  if (options.shipping) {
    for (const rate of Object.values(options.shipping.rates)) requireNonNegativeInt(rate, "shipping rate");
    requireNonNegativeInt(options.shipping.freeFromCents, "freeFromCents");
  }
  return { promotions: { ...(options.promotions ?? {}) }, shipping: options.shipping, taxRounding: options.taxRounding ?? "line" };
}

export function promoPercent(policy: PricingPolicy, code: string | undefined): number {
  if (code === undefined) return 0;
  const percent = policy.promotions[code];
  if (percent === undefined) fail("invalid_input", `unknown promotion ${code}`);
  return percent;
}

export function priceLines(policy: PricingPolicy, input: { region: Region; tier: Tier; promoPercent: number; lines: readonly PricingLine[] }): PriceQuote {
  let rawTax = 0;
  const lines = input.lines.map((line) => {
    const subtotalCents = line.unitPriceCents * line.quantity;
    const percent = Math.min(MAX_DISCOUNT, TIER_DISCOUNT[input.tier] + input.promoPercent + (line.quantity >= BULK_QUANTITY ? BULK_DISCOUNT : 0));
    const discountCents = percentOf(subtotalCents, percent);
    const net = subtotalCents - discountCents;
    const lineRawTax = (net * TAX_RATES[input.region][line.taxClass]) / 100;
    rawTax += lineRawTax;
    const taxCents = Math.round(lineRawTax);
    return { sku: line.sku, quantity: line.quantity, unitPriceCents: line.unitPriceCents, subtotalCents, discountCents, taxCents, totalCents: net + taxCents };
  });
  const netCents = lines.reduce((total, line) => total + line.subtotalCents - line.discountCents, 0);
  const shippingCents = policy.shipping && netCents < policy.shipping.freeFromCents ? policy.shipping.rates[input.region] : 0;
  const shippingRawTax = (shippingCents * TAX_RATES[input.region].standard) / 100;
  const taxCents =
    policy.taxRounding === "order"
      ? Math.round(rawTax + shippingRawTax)
      : lines.reduce((total, line) => total + line.taxCents, 0) + Math.round(shippingRawTax);
  return {
    lines,
    subtotalCents: lines.reduce((total, line) => total + line.subtotalCents, 0),
    discountCents: lines.reduce((total, line) => total + line.discountCents, 0),
    shippingCents,
    taxCents,
    totalCents: netCents + shippingCents + taxCents,
  };
}
