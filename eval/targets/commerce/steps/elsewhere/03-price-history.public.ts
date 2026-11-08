test("price updates are recorded and used by new orders", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  assert.equal(shop.catalog.updatePrice("pen", 1200, 200).priceCents, 1200);
  assert.deepEqual(shop.catalog.priceHistory("pen"), [
    { priceCents: 1000, at: 100 },
    { priceCents: 1200, at: 200 },
  ]);
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const order = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 1 }] });
  assert.equal(order.lines[0].unitPriceCents, 1200);
});
