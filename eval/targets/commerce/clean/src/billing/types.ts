import type { PricedLine } from "../pricing/index.ts";

export interface Invoice {
  id: string;
  orderId: string;
  customerId: string;
  status: "open";
  lines: PricedLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  issuedAt: number;
}
