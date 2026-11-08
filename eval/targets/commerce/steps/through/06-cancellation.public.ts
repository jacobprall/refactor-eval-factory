test("cancelling an order voids its invoice and notifies the customer", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const order = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 1 }] });
  assert.equal(shop.orders.cancelOrder(order.id, 200).status, "cancelled");
  assert.equal(shop.orders.getOrder(order.id).status, "cancelled");
  assert.equal(shop.billing.invoiceForOrder(order.id)?.status, "void");
  assert.deepEqual(
    shop.notifications.outbox().map((message: any) => message.template),
    ["order_confirmation", "order_cancelled"],
  );
});
