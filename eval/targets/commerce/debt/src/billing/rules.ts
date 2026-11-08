import type { InvoiceLine, InvoiceRequest } from "./types.ts";

export interface InvoiceDraft {
  customer: InvoiceRequest["customer"];
  lines: InvoiceLine[];
}

type InvoiceRule = (draft: InvoiceDraft) => void;

const TIER_PERCENT_OFF: Record<string, number> = { gold: 10 };
const REGION_TAX_PERCENT: Record<string, number> = { US: 7, EU: 20, UK: 20 };

const lineSubtotals: InvoiceRule = (draft) => {
  for (const line of draft.lines) line.subtotalCents = line.unitPriceCents * line.quantity;
};

const tierDiscount: InvoiceRule = (draft) => {
  const percent = TIER_PERCENT_OFF[draft.customer.tier] ?? 0;
  for (const line of draft.lines) line.discountCents = Math.round((line.subtotalCents * percent) / 100);
};

const regionalTax: InvoiceRule = (draft) => {
  const percent = REGION_TAX_PERCENT[draft.customer.region];
  for (const line of draft.lines) line.taxCents = Math.round(((line.subtotalCents - line.discountCents) * percent) / 100);
};

const lineTotals: InvoiceRule = (draft) => {
  for (const line of draft.lines) line.totalCents = line.subtotalCents - line.discountCents + line.taxCents;
};

/** Applied in order; each rule reads what the earlier rules wrote. */
export const INVOICE_RULES: readonly InvoiceRule[] = [lineSubtotals, tierDiscount, regionalTax, lineTotals];

export function applyInvoiceRules(request: InvoiceRequest): InvoiceDraft {
  const draft: InvoiceDraft = {
    customer: request.customer,
    lines: request.lines.map((line) => ({ ...line, subtotalCents: 0, discountCents: 0, taxCents: 0, totalCents: 0 })),
  };
  for (const rule of INVOICE_RULES) rule(draft);
  return draft;
}
