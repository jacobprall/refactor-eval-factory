import { createAccountDirectory } from "./accounts/index.ts";
import { BillingLedger } from "./billing/index.ts";
import { CatalogRepository } from "./catalog/index.ts";
import { createNotifier } from "./notifications/index.ts";
import type { Order } from "./orders/index.ts";
import { OrderService } from "./orders/index.ts";
import { EventBus } from "./shared/index.ts";

export type { Customer, Region, Tier } from "./accounts/index.ts";
export type { Invoice } from "./billing/index.ts";
export type { Product } from "./catalog/index.ts";
export type { Message } from "./notifications/index.ts";
export type { Order } from "./orders/index.ts";
export { CommerceError } from "./shared/index.ts";

export interface CommerceOptions {
  now?: () => number;
}

/** The composition root: the only place that knows how modules are wired together. */
export function createCommerce(options: CommerceOptions = {}) {
  const now = options.now ?? Date.now;
  const bus = new EventBus();
  const catalog = new CatalogRepository();
  const accounts = createAccountDirectory();
  const orders = new OrderService({ catalog, accounts, bus, now });
  const billing = new BillingLedger();

  bus.subscribe("order.placed", (event) => {
    const order = event.order as Order;
    const invoice = billing.invoiceOrder(order, event.at);
    bus.publish({
      type: "invoice.issued",
      at: event.at,
      invoiceId: invoice.id,
      orderId: order.id,
      customerId: order.customerId,
      totalCents: order.totalCents,
      itemCount: order.lines.reduce((total, line) => total + line.quantity, 0),
    });
  });

  const notifications = createNotifier({ bus, accounts });

  return { bus, catalog, accounts, orders, billing, notifications };
}
