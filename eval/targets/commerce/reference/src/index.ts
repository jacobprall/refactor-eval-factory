import { createAccountDirectory } from "./accounts/index.ts";
import { BillingLedger } from "./billing/index.ts";
import { CatalogRepository } from "./catalog/index.ts";
import { createNotifier } from "./notifications/index.ts";
import type { Order, Refund } from "./orders/index.ts";
import { OrderService } from "./orders/index.ts";
import { createPricingPolicy, type ShippingPolicy } from "./pricing/index.ts";
import { createReviews } from "./reviews/index.ts";
import { EventBus } from "./shared/index.ts";
import { createWishlists } from "./wishlists/index.ts";

export type { Address, Customer, Region, Tier } from "./accounts/index.ts";
export type { CreditNote, Invoice, Statement } from "./billing/index.ts";
export type { Product } from "./catalog/index.ts";
export type { Message } from "./notifications/index.ts";
export type { Order, Refund } from "./orders/index.ts";
export { CommerceError } from "./shared/index.ts";

export interface CommerceOptions {
  now?: () => number;
  promotions?: Record<string, number>;
  shipping?: ShippingPolicy;
  taxRounding?: "line" | "order";
}

/** The composition root: the only place that knows how modules are wired together. */
export function createCommerce(options: CommerceOptions = {}) {
  const now = options.now ?? Date.now;
  const bus = new EventBus();
  const catalog = new CatalogRepository({ now });
  const accounts = createAccountDirectory();
  const pricing = createPricingPolicy(options);
  const orders = new OrderService({ catalog, accounts, bus, pricing, now });
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
  bus.subscribe("order.cancelled", (event) => billing.voidForOrder(event.orderId as string));
  bus.subscribe("order.refunded", (event) => billing.creditRefund(event.orderId as string, event.refund as Refund));

  const notifications = createNotifier({ bus, accounts });
  const wishlists = createWishlists({ accounts, catalog });
  const reviews = createReviews({ accounts, catalog });

  return { bus, catalog, accounts, orders, billing, notifications, wishlists, reviews };
}

export type Commerce = ReturnType<typeof createCommerce>;
