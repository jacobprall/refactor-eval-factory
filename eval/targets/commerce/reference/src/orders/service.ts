import type { AccountDirectory } from "../accounts/index.ts";
import type { CatalogRepository } from "../catalog/index.ts";
import { type PricingPolicy, priceLines, promoPercent } from "../pricing/index.ts";
import { createIdGenerator, type EventBus, fail, requirePositiveInt } from "../shared/index.ts";
import { OrderStore } from "./store.ts";
import type { Order, PlaceOrderInput, Refund } from "./types.ts";

export interface OrderServiceDeps {
  catalog: CatalogRepository;
  accounts: AccountDirectory;
  bus: EventBus;
  pricing: PricingPolicy;
  now: () => number;
}

export class OrderService {
  private readonly deps: OrderServiceDeps;
  private readonly store = new OrderStore();
  private readonly orderId = createIdGenerator("o");
  private readonly refundId = createIdGenerator("r");

  constructor(deps: OrderServiceDeps) {
    this.deps = deps;
  }

  placeOrder(input: PlaceOrderInput, at = this.deps.now()): Order {
    const customer = this.deps.accounts.get(input.customerId);
    if (!customer.active) fail("invalid_state", `customer ${customer.id} is inactive`);
    if (!Array.isArray(input.lines) || input.lines.length === 0) fail("invalid_input", "an order needs at least one line");
    const skus = new Set<string>();
    const lines = input.lines.map((line) => {
      const quantity = requirePositiveInt(line.quantity, "quantity");
      const product = this.deps.catalog.get(line.sku);
      if (product.discontinued) fail("invalid_state", `product ${product.sku} is discontinued`);
      if (skus.has(product.sku)) fail("invalid_input", `sku ${product.sku} appears twice`);
      skus.add(product.sku);
      const unitPriceCents = this.deps.accounts.contractPrice(customer.id, product.sku) ?? product.priceCents;
      return { sku: product.sku, quantity, unitPriceCents, taxClass: product.taxClass };
    });
    const quote = priceLines(this.deps.pricing, {
      region: customer.region,
      tier: customer.tier,
      promoPercent: promoPercent(this.deps.pricing, input.promoCode),
      lines,
    });
    const order: Order = {
      id: this.orderId(),
      customerId: customer.id,
      status: "placed",
      ...quote,
      ...(input.promoCode !== undefined ? { promoCode: input.promoCode } : {}),
      placedAt: at,
      refunds: [],
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

  cancelOrder(id: string, at = this.deps.now()): Order {
    const order = this.store.get(id);
    if (order.status !== "placed") fail("invalid_state", `order ${id} is ${order.status}`);
    if (order.refunds.length > 0) fail("invalid_state", `order ${id} has refunds`);
    order.status = "cancelled";
    order.cancelledAt = at;
    this.store.save(order);
    this.deps.bus.publish({ type: "order.cancelled", at, orderId: order.id, customerId: order.customerId });
    return order;
  }

  refundLine(orderId: string, sku: string, quantity: number, at = this.deps.now()): Refund {
    const order = this.store.get(orderId);
    if (order.status !== "placed") fail("invalid_state", `order ${orderId} is ${order.status}`);
    const line = order.lines.find((candidate) => candidate.sku === sku);
    if (!line) fail("invalid_input", `sku ${sku} is not on order ${orderId}`);
    const refunded = order.refunds.filter((refund) => refund.sku === sku).reduce((total, refund) => total + refund.quantity, 0);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > line.quantity - refunded) {
      fail("invalid_input", `cannot refund ${quantity} of ${sku}`);
    }
    const lineAmount = line.subtotalCents - line.discountCents + line.taxCents;
    const refund: Refund = { id: this.refundId(), sku, quantity, amountCents: Math.round((lineAmount * quantity) / line.quantity), at };
    order.refunds.push(refund);
    this.store.save(order);
    this.deps.bus.publish({ type: "order.refunded", at, orderId, customerId: order.customerId, refund: { ...refund } });
    return { ...refund };
  }
}
