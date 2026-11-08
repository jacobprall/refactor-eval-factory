import type { Order } from "../orders/index.ts";
import { createIdGenerator } from "../shared/index.ts";
import type { Invoice } from "./types.ts";

/** Invoices take their amounts from the priced order, so billing and ordering can never disagree. */
export class BillingLedger {
  private readonly invoices: Invoice[] = [];
  private readonly invoiceId = createIdGenerator("i");

  invoiceOrder(order: Order, at: number): Invoice {
    const invoice: Invoice = {
      id: this.invoiceId(),
      orderId: order.id,
      customerId: order.customerId,
      status: "open",
      lines: structuredClone(order.lines),
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
      issuedAt: at,
    };
    this.invoices.push(invoice);
    return structuredClone(invoice);
  }

  getInvoice(id: string): Invoice | undefined {
    const invoice = this.invoices.find((candidate) => candidate.id === id);
    return invoice ? structuredClone(invoice) : undefined;
  }

  invoiceForOrder(orderId: string): Invoice | undefined {
    const invoice = this.invoices.find((candidate) => candidate.orderId === orderId);
    return invoice ? structuredClone(invoice) : undefined;
  }

  listInvoices(customerId?: string): Invoice[] {
    return this.invoices.filter((invoice) => customerId === undefined || invoice.customerId === customerId).map((invoice) => structuredClone(invoice));
  }
}
