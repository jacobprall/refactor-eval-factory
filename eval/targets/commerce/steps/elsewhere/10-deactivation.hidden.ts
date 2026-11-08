test("deactivation keeps history and affects only that customer", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const ann = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const bob = shop.accounts.register({ name: "Bob", email: "bob@example.test", region: "US" });
  const order = shop.orders.placeOrder({ customerId: ann.id, lines: [{ sku: "pen", quantity: 1 }] });
  shop.accounts.deactivate(ann.id);
  shop.accounts.deactivate(ann.id);
  assert.equal(shop.orders.getOrder(order.id).totalCents, 1070);
  assert.equal(shop.billing.invoiceForOrder(order.id)?.totalCents, 1070);
  assert.equal(shop.orders.placeOrder({ customerId: bob.id, lines: [{ sku: "pen", quantity: 1 }] }).totalCents, 1070);
  assert.throws(() => shop.accounts.deactivate("missing"), (error: any) => error.code === "not_found");
});
