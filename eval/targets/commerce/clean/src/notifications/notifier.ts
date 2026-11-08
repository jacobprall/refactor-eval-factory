import type { AccountDirectory } from "../accounts/index.ts";
import { createIdGenerator, type EventBus } from "../shared/index.ts";

export interface Message {
  id: string;
  customerId: string;
  channel: "email";
  to: string;
  template: "order_confirmation";
  body: string;
  at: number;
}

/** Reacts to published events only; everything a message needs arrives in the event or through the accounts API. */
export function createNotifier(deps: { bus: EventBus; accounts: AccountDirectory }) {
  const outbox: Message[] = [];
  const messageId = createIdGenerator("n");

  deps.bus.subscribe("invoice.issued", (event) => {
    const customer = deps.accounts.get(event.customerId as string);
    outbox.push({
      id: messageId(),
      customerId: customer.id,
      channel: "email",
      to: customer.email,
      template: "order_confirmation",
      body: `Order ${event.orderId} confirmed`,
      at: event.at,
    });
  });

  return {
    outbox(): Message[] {
      return outbox.map((message) => ({ ...message }));
    },
  };
}
