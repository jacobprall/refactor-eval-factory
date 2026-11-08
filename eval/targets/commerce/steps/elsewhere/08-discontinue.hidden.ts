test("discontinued products stay readable and earlier orders are untouched", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  shop.catalog.add({ sku: "mug", name: "Mug", priceCents: 900, category: "kitchen" });
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const order = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "mug", quantity: 1 }] });
  shop.catalog.discontinue("mug");
  shop.catalog.discontinue("mug");
  assert.equal(shop.catalog.get("mug").discontinued, true);
  assert.equal(shop.catalog.get("pen").discontinued, false);
  assert.deepEqual(shop.catalog.list().map((product: any) => product.sku), ["mug", "pen"]);
  assert.equal(shop.orders.getOrder(order.id).lines[0].sku, "mug");
  assert.throws(() => shop.catalog.discontinue("missing"), (error: any) => error.code === "not_found");
});
