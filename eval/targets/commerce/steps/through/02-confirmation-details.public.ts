test("confirms an order with its item count, total, and invoice", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const order = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 2 }] });
  const invoice = shop.billing.invoiceForOrder(order.id);
  const [message] = shop.notifications.outbox();
  assert.equal(message.body, `Order ${order.id} confirmed: 2 items, total $21.40, invoice ${invoice?.id}`);
  assert.equal(message.to, "ann@example.test");
});
