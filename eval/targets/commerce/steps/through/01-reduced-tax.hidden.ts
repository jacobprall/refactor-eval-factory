test("reduced tax composes with the gold discount, varies by region, and rejects unknown tax classes", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "map", name: "Map", priceCents: 1999, category: "media", taxClass: "reduced" });
  const uk = shop.accounts.register({ name: "Uma", email: "uma@example.test", region: "UK", tier: "gold" });
  const order = shop.orders.placeOrder({ customerId: uk.id, lines: [{ sku: "map", quantity: 3 }] });
  assert.equal(order.lines[0].discountCents, 600);
  assert.equal(order.lines[0].taxCents, 270);
  assert.deepEqual(shop.billing.invoiceForOrder(order.id)?.lines, order.lines);
  const us = shop.accounts.register({ name: "Ira", email: "ira@example.test", region: "US" });
  const usOrder = shop.orders.placeOrder({ customerId: us.id, lines: [{ sku: "map", quantity: 1 }] });
  assert.equal(usOrder.taxCents, 60);
  assert.equal(shop.billing.invoiceForOrder(usOrder.id)?.taxCents, 60);
  assert.throws(
    () => shop.catalog.add({ sku: "x", name: "X", priceCents: 1, category: "c", taxClass: "zero" as any }),
    (error: any) => error.code === "invalid_input",
  );
});
