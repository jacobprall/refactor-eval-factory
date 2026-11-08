test("silver customers get five percent off each line", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const customer = shop.accounts.register({ name: "Sal", email: "sal@example.test", region: "US", tier: "silver" });
  const order = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 1 }] });
  assert.equal(order.discountCents, 50);
  assert.equal(order.taxCents, 67);
  assert.equal(order.totalCents, 1017);
  assert.equal(shop.billing.invoiceForOrder(order.id)?.totalCents, 1017);
});
