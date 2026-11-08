test("discontinued products leave search and cannot be ordered", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  shop.catalog.add({ sku: "mug", name: "Mug", priceCents: 900, category: "kitchen" });
  shop.catalog.discontinue("mug");
  assert.deepEqual(shop.catalog.search({}).map((product: any) => product.sku), ["pen"]);
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  assert.throws(
    () => shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "mug", quantity: 1 }] }),
    (error: any) => error.code === "invalid_state",
  );
});
