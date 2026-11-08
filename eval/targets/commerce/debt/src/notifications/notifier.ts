import type { AccountDirectory } from "../accounts/index.ts";
import type { OrderStore } from "../orders/store.ts";
import { type EventBus, nextId } from "../shared/index.ts";

export interface Message {
  id: string;
  customerId: string;
  channel: "email";
  to: string;
  template: "order_confirmation";
  body: string;
  at: number;
}

export function createNotifier(deps: { bus: EventBus; accounts: AccountDirectory; orders: OrderStore }) {
  const outbox: Message[] = [];
  const messageId = nextId("n");

  deps.bus.subscribe("order.placed", (event) => {
    const order = deps.orders.get(event.orderId as string);
    const customer = deps.accounts.get(order.customerId);
    outbox.push({
      id: messageId(),
      customerId: customer.id,
      channel: "email",
      to: customer.email,
      template: "order_confirmation",
      body: `Order ${order.id} confirmed`,
      at: event.at,
    });
  });

  return {
    outbox(): Message[] {
      return outbox.map((message) => ({ ...message }));
    },
  };
}
