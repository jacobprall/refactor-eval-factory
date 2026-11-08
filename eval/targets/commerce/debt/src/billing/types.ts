import type { Region, Tier } from "../accounts/index.ts";

export interface InvoiceLine {
  sku: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

export interface Invoice {
  id: string;
  orderId: string;
  customerId: string;
  status: "open";
  lines: InvoiceLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  issuedAt: number;
}

export interface InvoiceRequest {
  orderId: string;
  customer: { id: string; region: Region; tier: Tier };
  lines: { sku: string; quantity: number; unitPriceCents: number }[];
  at: number;
}
