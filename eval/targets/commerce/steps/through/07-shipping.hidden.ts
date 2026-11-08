test("shipping is free at the discounted threshold, regional below it, and absent when not configured", () => {
  const shipping = { rates: { US: 500, EU: 800, UK: 700 }, freeFromCents: 5000 };
  const shop = subject.createCommerce({ now: () => 100, shipping });
  shop.catalog.add({ sku: "desk", name: "Desk", priceCents: 5556, category: "home" });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const gold = shop.accounts.register({ name: "Gus", email: "gus@example.test", region: "EU", tier: "gold" });
  const free = shop.orders.placeOrder({ customerId: gold.id, lines: [{ sku: "desk", quantity: 1 }] });
  assert.equal(free.shippingCents, 0);
  assert.equal(free.totalCents, 6000);
  assert.equal(shop.billing.invoiceForOrder(free.id)?.totalCents, 6000);
  const uk = shop.accounts.register({ name: "Una", email: "una@example.test", region: "UK" });
  const paid = shop.orders.placeOrder({ customerId: uk.id, lines: [{ sku: "pen", quantity: 1 }] });
  assert.equal(paid.shippingCents, 700);
  assert.equal(paid.taxCents, 340);
  assert.equal(shop.billing.invoiceForOrder(paid.id)?.totalCents, 2040);

  const plain = subject.createCommerce({ now: () => 100 });
  plain.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const customer = plain.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const order = plain.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 1 }] });
  assert.equal(order.shippingCents, 0);
  assert.equal(plain.billing.invoiceForOrder(order.id)?.shippingCents, 0);
});
