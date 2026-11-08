import { createAccountDirectory } from "./accounts/index.ts";
import { BillingService } from "./billing/index.ts";
import { CatalogRepository } from "./catalog/index.ts";
import { createNotifier } from "./notifications/index.ts";
import { OrderService } from "./orders/index.ts";
import { OrderStore } from "./orders/store.ts";
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

export function createCommerce(options: CommerceOptions = {}) {
  const now = options.now ?? Date.now;
  const bus = new EventBus();
  const catalog = new CatalogRepository();
  const accounts = createAccountDirectory();
  const store = new OrderStore();
  const orders = new OrderService({ catalog, accounts, bus, store, now });
  const billing = new BillingService();

  bus.subscribe("order.placed", (event) => {
    const order = orders.getOrder(event.orderId as string);
    const customer = accounts.get(order.customerId);
    billing.createInvoice({
      orderId: order.id,
      customer: { id: customer.id, region: customer.region, tier: customer.tier },
      lines: order.lines.map((line) => ({ sku: line.sku, quantity: line.quantity, unitPriceCents: line.unitPriceCents })),
      at: event.at,
    });
  });

  const notifications = createNotifier({ bus, accounts, orders: store });

  return { bus, catalog, accounts, orders, billing, notifications };
}
