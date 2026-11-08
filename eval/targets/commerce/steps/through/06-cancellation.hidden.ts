test("cancellation is once-only, scoped to one order, and fully reported", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const customer = shop.accounts.register({ name: "Dee", email: "dee@example.test", region: "US" });
  const kept = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 1 }] });
  const order = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 1 }] });
  shop.orders.cancelOrder(order.id, 200);
  assert.equal(shop.orders.getOrder(order.id).cancelledAt, 200);
  assert.equal(shop.billing.invoiceForOrder(kept.id)?.status, "open");
  assert.equal(shop.notifications.outbox().at(-1)?.body, `Order ${order.id} cancelled`);
  assert.throws(() => shop.orders.cancelOrder(order.id, 300), (error: any) => error.code === "invalid_state");
  assert.throws(() => shop.orders.cancelOrder("missing", 300), (error: any) => error.code === "not_found");
  assert.equal(shop.notifications.outbox().length, 3);
});
