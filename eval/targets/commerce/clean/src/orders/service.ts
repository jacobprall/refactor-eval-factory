import type { AccountDirectory } from "../accounts/index.ts";
import type { CatalogRepository } from "../catalog/index.ts";
import { priceLines } from "../pricing/index.ts";
import { createIdGenerator, type EventBus, fail, requirePositiveInt } from "../shared/index.ts";
import { OrderStore } from "./store.ts";
import type { Order, PlaceOrderInput } from "./types.ts";

export interface OrderServiceDeps {
  catalog: CatalogRepository;
  accounts: AccountDirectory;
  bus: EventBus;
  now: () => number;
}

export class OrderService {
  private readonly deps: OrderServiceDeps;
  private readonly store = new OrderStore();
  private readonly orderId = createIdGenerator("o");

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
      return { sku: product.sku, quantity, unitPriceCents: product.priceCents, taxClass: product.taxClass };
    });
    const order: Order = {
      id: this.orderId(),
      customerId: customer.id,
      status: "placed",
      ...priceLines({ region: customer.region, tier: customer.tier, lines }),
      placedAt: at,
    };
    this.store.save(order);
    this.deps.bus.publish({ type: "order.placed", at, orderId: order.id, customerId: order.customerId, order: structuredClone(order) });
    return structuredClone(order);
  }

  getOrder(id: string): Order {
    return this.store.get(id);
  }

  listOrders(customerId?: string): Order[] {
    return this.store.list().filter((order) => customerId === undefined || order.customerId === customerId);
  }
}
