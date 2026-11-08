export interface OrderLine {
  sku: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

export interface Order {
  id: string;
  customerId: string;
  status: "placed";
  lines: OrderLine[];
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
