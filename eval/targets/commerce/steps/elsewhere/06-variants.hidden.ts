test("variants are products: orderable and searchable, one level deep, with unique skus", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  shop.catalog.addVariant("pen", { sku: "pen-blue", name: "Blue Pen", priceCents: 1100 });
  assert.throws(() => shop.catalog.addVariant("pen-blue", { sku: "pen-navy", name: "Navy", priceCents: 1 }), (error: any) => error.code === "invalid_input");
  assert.throws(() => shop.catalog.addVariant("missing", { sku: "x", name: "X", priceCents: 1 }), (error: any) => error.code === "not_found");
  assert.throws(() => shop.catalog.addVariant("pen", { sku: "pen", name: "Dup", priceCents: 1 }), (error: any) => error.code === "conflict");
  assert.deepEqual(shop.catalog.search({ text: "blue" }).map((product: any) => product.sku), ["pen-blue"]);
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const order = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen-blue", quantity: 1 }] });
  assert.equal(order.totalCents, 1177);
});
