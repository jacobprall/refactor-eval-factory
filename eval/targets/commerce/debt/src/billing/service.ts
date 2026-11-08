import { clone, nextId, sumBy } from "../shared/index.ts";
import { applyInvoiceRules } from "./rules.ts";
import type { Invoice, InvoiceRequest } from "./types.ts";

export class BillingService {
  private readonly invoices: Invoice[] = [];
  private readonly invoiceId = nextId("i");

  createInvoice(request: InvoiceRequest): Invoice {
    const draft = applyInvoiceRules(request);
    const invoice: Invoice = {
      id: this.invoiceId(),
      orderId: request.orderId,
      customerId: request.customer.id,
      status: "open",
      lines: draft.lines,
      subtotalCents: sumBy(draft.lines, (line) => line.subtotalCents),
      discountCents: sumBy(draft.lines, (line) => line.discountCents),
      taxCents: sumBy(draft.lines, (line) => line.taxCents),
      totalCents: sumBy(draft.lines, (line) => line.totalCents),
      issuedAt: request.at,
    };
    this.invoices.push(invoice);
    return clone(invoice);
  }

  getInvoice(id: string): Invoice | undefined {
    const invoice = this.invoices.find((candidate) => candidate.id === id);
    return invoice ? clone(invoice) : undefined;
  }

  invoiceForOrder(orderId: string): Invoice | undefined {
    const invoice = this.invoices.find((candidate) => candidate.orderId === orderId);
    return invoice ? clone(invoice) : undefined;
  }

  listInvoices(customerId?: string): Invoice[] {
    return this.invoices.filter((invoice) => customerId === undefined || invoice.customerId === customerId).map(clone);
  }
}
