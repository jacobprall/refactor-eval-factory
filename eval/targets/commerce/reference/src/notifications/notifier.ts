import type { AccountDirectory, Channel } from "../accounts/index.ts";
import { type CommerceEvent, createIdGenerator, type EventBus, formatCents } from "../shared/index.ts";

export type Template = "order_confirmation" | "order_cancelled" | "refund_issued";

export interface Message {
  id: string;
  customerId: string;
  channel: Channel;
  to: string;
  template: Template;
  body: string;
  at: number;
}

export type Notifier = ReturnType<typeof createNotifier>;

/** Reacts to published events only; everything a message needs arrives in the event or through the accounts API. */
export function createNotifier(deps: { bus: EventBus; accounts: AccountDirectory }) {
  const outbox: Message[] = [];
  const messageId = createIdGenerator("n");

  const send = (event: CommerceEvent, template: Template, body: string) => {
    const customer = deps.accounts.get(event.customerId as string);
    const to = customer.channel === "sms" && customer.phone ? customer.phone : customer.email;
    outbox.push({ id: messageId(), customerId: customer.id, channel: customer.channel, to, template, body, at: event.at });
  };

  deps.bus.subscribe("invoice.issued", (event) => {
    send(event, "order_confirmation", `Order ${event.orderId} confirmed: ${event.itemCount} items, total ${formatCents(event.totalCents as number)}, invoice ${event.invoiceId}`);
  });
  deps.bus.subscribe("order.cancelled", (event) => send(event, "order_cancelled", `Order ${event.orderId} cancelled`));
  deps.bus.subscribe("order.refunded", (event) => {
    const refund = event.refund as { amountCents: number };
    send(event, "refund_issued", `Refund of ${formatCents(refund.amountCents)} issued for order ${event.orderId}`);
  });

  return {
    outbox(): Message[] {
      return outbox.map((message) => ({ ...message }));
    },
  };
}
