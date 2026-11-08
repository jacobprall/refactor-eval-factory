test("deactivated customers cannot place orders", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  assert.equal(customer.active, true);
  shop.accounts.deactivate(customer.id);
  assert.equal(shop.accounts.get(customer.id).active, false);
  assert.throws(
    () => shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 1 }] }),
    (error: any) => error.code === "invalid_state",
  );
});
