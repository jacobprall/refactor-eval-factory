import type { PricedLine } from "../pricing/index.ts";

export type OrderStatus = "placed" | "cancelled";

export interface Refund {
  id: string;
  sku: string;
  quantity: number;
  amountCents: number;
  at: number;
}

export interface Order {
  id: string;
  customerId: string;
  status: OrderStatus;
  lines: PricedLine[];
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  promoCode?: string;
  placedAt: number;
  cancelledAt?: number;
  refunds: Refund[];
}

export interface PlaceOrderInput {
  customerId: string;
  lines: { sku: string; quantity: number }[];
  promoCode?: string;
}
