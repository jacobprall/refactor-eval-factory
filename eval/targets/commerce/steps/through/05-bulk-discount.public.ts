test("lines of ten or more units get five extra percentage points off", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "clip", name: "Clip", priceCents: 100, category: "office" });
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const order = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "clip", quantity: 10 }] });
  assert.equal(order.discountCents, 50);
  assert.equal(order.totalCents, 1017);
  assert.equal(shop.billing.invoiceForOrder(order.id)?.totalCents, 1017);
});
