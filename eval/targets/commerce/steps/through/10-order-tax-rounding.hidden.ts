test("line rounding stays the default and order rounding includes shipping tax", () => {
  const lines = [{ sku: "a", quantity: 1 }, { sku: "b", quantity: 1 }, { sku: "c", quantity: 1 }];
  const plain = subject.createCommerce({ now: () => 100 });
  for (const sku of ["a", "b", "c"]) plain.catalog.add({ sku, name: sku, priceCents: 5, category: "small" });
  const ann = plain.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  assert.equal(plain.orders.placeOrder({ customerId: ann.id, lines }).taxCents, 0);

  const shipping = { rates: { US: 5, EU: 8, UK: 7 }, freeFromCents: 100000 };
  const shop = subject.createCommerce({ now: () => 100, taxRounding: "order", shipping });
  for (const sku of ["a", "b", "c"]) shop.catalog.add({ sku, name: sku, priceCents: 5, category: "small" });
  const bea = shop.accounts.register({ name: "Bea", email: "bea@example.test", region: "US" });
  const order = shop.orders.placeOrder({ customerId: bea.id, lines });
  assert.equal(order.taxCents, 1);
  assert.equal(order.totalCents, 21);
  assert.deepEqual(shop.billing.invoiceForOrder(order.id)?.lines, order.lines);
  assert.equal(shop.billing.invoiceForOrder(order.id)?.totalCents, 21);
  assert.equal(shop.orders.refundLine(order.id, "a", 1, 200).amountCents, 5);
});
