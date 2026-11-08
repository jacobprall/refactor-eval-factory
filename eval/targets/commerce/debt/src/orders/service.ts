import type { AccountDirectory } from "../accounts/index.ts";
import type { CatalogRepository } from "../catalog/index.ts";
import { type EventBus, fail, nextId, requirePositiveInt } from "../shared/index.ts";
import { priceOrderLines } from "./pricing.ts";
import type { OrderStore } from "./store.ts";
import type { Order, PlaceOrderInput } from "./types.ts";

export interface OrderServiceDeps {
  catalog: CatalogRepository;
  accounts: AccountDirectory;
  bus: EventBus;
  store: OrderStore;
  now: () => number;
}

export class OrderService {
  private readonly deps: OrderServiceDeps;
  private readonly orderId = nextId("o");

  constructor(deps: OrderServiceDeps) {
    this.deps = deps;
  }

  placeOrder(input: PlaceOrderInput, at = this.deps.now()): Order {
    const customer = this.deps.accounts.get(input.customerId);
    if (!Array.isArray(input.lines) || input.lines.length === 0) fail("invalid_input", "an order needs at least one line");
    const skus = new Set<string>();
    const lines = input.lines.map((line) => {
      const quantity = requirePositiveInt(line.quantity, "quantity");
      const product = this.deps.catalog.get(line.sku);
      if (skus.has(product.sku)) fail("invalid_input", `sku ${product.sku} appears twice`);
      skus.add(product.sku);
      return { sku: product.sku, quantity, unitPriceCents: product.priceCents };
    });
    const order: Order = { id: this.orderId(), customerId: customer.id, status: "placed", ...priceOrderLines(customer, lines), placedAt: at };
    this.deps.store.save(order);
    this.deps.bus.publish({ type: "order.placed", at, orderId: order.id });
    return this.deps.store.get(order.id);
  }

  getOrder(id: string): Order {
    return this.deps.store.get(id);
  }

  listOrders(customerId?: string): Order[] {
    return this.deps.store.list().filter((order) => customerId === undefined || order.customerId === customerId);
  }
}
