import type { PricedLine } from "../pricing/index.ts";

export type InvoiceStatus = "open" | "void";

export interface Invoice {
  id: string;
  orderId: string;
  customerId: string;
  status: InvoiceStatus;
  lines: PricedLine[];
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  issuedAt: number;
}

export interface CreditNote {
  id: string;
  invoiceId: string;
  orderId: string;
  refundId: string;
  amountCents: number;
  at: number;
}

export interface Statement {
  invoices: Invoice[];
  creditNotes: CreditNote[];
  balanceCents: number;
}
