import type { Order, Refund } from "../orders/index.ts";
import { createIdGenerator } from "../shared/index.ts";
import type { CreditNote, Invoice, Statement } from "./types.ts";

/** Invoices take their amounts from the priced order, so billing and ordering can never disagree. */
export class BillingLedger {
  private readonly invoices: Invoice[] = [];
  private readonly credits: CreditNote[] = [];
  private readonly invoiceId = createIdGenerator("i");
  private readonly creditId = createIdGenerator("cn");

  invoiceOrder(order: Order, at: number): Invoice {
    const invoice: Invoice = {
      id: this.invoiceId(),
      orderId: order.id,
      customerId: order.customerId,
      status: "open",
      lines: structuredClone(order.lines),
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      shippingCents: order.shippingCents,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
      issuedAt: at,
    };
    this.invoices.push(invoice);
    return structuredClone(invoice);
  }

  voidForOrder(orderId: string): void {
    const invoice = this.invoices.find((candidate) => candidate.orderId === orderId);
    if (invoice) invoice.status = "void";
  }

  creditRefund(orderId: string, refund: Refund): CreditNote | undefined {
    const invoice = this.invoices.find((candidate) => candidate.orderId === orderId);
    if (!invoice) return undefined;
    const note: CreditNote = { id: this.creditId(), invoiceId: invoice.id, orderId, refundId: refund.id, amountCents: refund.amountCents, at: refund.at };
    this.credits.push(note);
    return { ...note };
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

  creditNotes(orderId: string): CreditNote[] {
    return this.credits.filter((note) => note.orderId === orderId).map((note) => ({ ...note }));
  }

  statement(customerId: string): Statement {
    const invoices = this.listInvoices(customerId);
    const orderIds = new Set(invoices.map((invoice) => invoice.orderId));
    const creditNotes = this.credits.filter((note) => orderIds.has(note.orderId)).map((note) => ({ ...note }));
    const open = invoices.filter((invoice) => invoice.status === "open").reduce((total, invoice) => total + invoice.totalCents, 0);
    return { invoices, creditNotes, balanceCents: open - creditNotes.reduce((total, note) => total + note.amountCents, 0) };
  }
}
