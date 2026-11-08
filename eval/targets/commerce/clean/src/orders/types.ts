import type { PricedLine } from "../pricing/index.ts";

export interface Order {
  id: string;
  customerId: string;
  status: "placed";
  lines: PricedLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  placedAt: number;
}

export interface PlaceOrderInput {
  customerId: string;
  lines: { sku: string; quantity: number }[];
}
