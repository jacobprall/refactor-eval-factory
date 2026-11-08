import { fail } from "../shared/index.ts";
import type { Order } from "./types.ts";

export class OrderStore {
  private readonly orders = new Map<string, Order>();

  save(order: Order): void {
    this.orders.set(order.id, structuredClone(order));
  }

  get(id: string): Order {
    const order = this.orders.get(id);
    if (!order) fail("not_found", `order ${id} not found`);
    return structuredClone(order);
  }

  list(): Order[] {
    return [...this.orders.values()].map((order) => structuredClone(order));
  }
}
